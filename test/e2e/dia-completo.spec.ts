import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  apiBaseUrl,
  expectApiUp,
  hideDevtools,
  loginOwner,
  ownerApi,
  runSuffix,
  skipWithoutSessionCookies,
  type OwnerApi,
} from './fixtures'

/**
 * Dia completo (plano, fase 7.5; spec 01, seção 14.2; specs 04 e 05) contra a API real, como o
 * dono usaria pela primeira vez, sem saber os caminhos: o início do painel diz o que fazer.
 * Abrir caixa → vender no balcão → cozinha (um cartão por pedido) → entregar → receber →
 * fechar o caixa com uma comanda pendente, que continua aberta.
 *
 * Usa uma unidade nova (com o "Caixa 1" que toda unidade ganha, RN-03.03) para não mexer no
 * caixa do seed; no fim, cancela a comanda pendente e desativa a unidade.
 */

let api: OwnerApi

test.beforeAll(async () => {
  await expectApiUp()
  api = await ownerApi()
})

test.afterAll(async () => {
  await api?.request.dispose()
})

test.beforeEach(({ browserName }) => {
  skipWithoutSessionCookies(browserName)
})

async function device(
  browser: Browser,
  baseURL: string | undefined,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 360, height: 780 },
    hasTouch: true,
    isMobile: true,
  })
  await hideDevtools(context)
  return { context, page: await context.newPage() }
}

test('dia completo: abrir caixa, vender, cozinha, receber e fechar com comanda pendente', async ({
  browser,
  baseURL,
}) => {
  const suffix = runSuffix()
  const unitName = `Feira ${suffix}`
  const unit = await api.post<{ id: string; version: number }>('/units', {
    name: unitName,
    lateAfterMinutes: 15,
  })
  const category = await api.post<{ id: string }>('/categories', {
    unitId: unit.id,
    name: 'Espetos',
  })
  await api.post('/products', {
    categoryId: category.id,
    name: 'Espeto de frango',
    priceCents: 1200,
  })
  const registers = await api.get<{ data: { id: string }[] }>(`/units/${unit.id}/cash-registers`)
  const registerId = registers.data[0]!.id

  const counter = await device(browser, baseURL)
  const kitchen = await device(browser, baseURL)
  let pendingTabId: string | null = null
  try {
    // 1. Início: sem caixa aberto, a única ação principal é "Abrir caixa" (CA-01.18).
    await loginOwner(counter.page)
    await counter.page.getByRole('button', { name: new RegExp(unitName) }).click()
    const home = counter.page.getByTestId('home-action')
    await expect(home).toHaveAttribute('data-state', 'open-cash')
    await expect(counter.page.getByTestId('primary-action')).toHaveText(/Abrir caixa/)
    await counter.page.getByTestId('primary-action').click()
    await expect(counter.page).toHaveURL(new RegExp(`/caixas/${registerId}/abrir$`))
    await counter.page.getByLabel('Troco inicial na gaveta').fill('50,00')
    await counter.page.getByTestId('confirm-open').click()

    // De volta ao início: agora a ação é "Abrir balcão", sem recarregar a tela.
    await expect(counter.page).toHaveURL(/\/painel$/)
    await expect(home).toHaveAttribute('data-state', 'open-counter')
    await expect(counter.page.getByTestId('open-registers')).toContainText('Caixa 1')
    await counter.page.getByTestId('primary-action').click()
    await expect(counter.page).toHaveURL(/\/balcao$/)
    await expect(counter.page.getByTestId('strip-cash')).toHaveText('Caixa 1 aberto')
    await expect(counter.page.getByTestId('strip-price-list')).toContainText('Preços: Normal')

    // 2. Cozinha no outro aparelho (o dono também abre estações), pelo "Balcão e estações".
    await loginOwner(kitchen.page)
    await kitchen.page.goto('/estacoes')
    await kitchen.page.getByRole('button', { name: new RegExp(unitName) }).click()
    await kitchen.page.getByRole('button', { name: /Cozinha/ }).click()
    await expect(kitchen.page.getByTestId('realtime-status')).toContainText('Conectado')

    // 3. Venda: comanda aberta e pedido de 2 espetos.
    const customer = `Cliente ${suffix}`
    await counter.page.getByTestId('new-tab').click()
    await counter.page.getByLabel('Nome do cliente').fill(customer)
    await counter.page.getByRole('button', { name: 'Abrir comanda' }).click()
    await expect(counter.page).toHaveURL(/\/balcao\/comandas\/1\/pedido$/)
    await counter.page.getByRole('button', { name: /^Espeto de frango/ }).click()
    await counter.page.getByRole('button', { name: /^Espeto de frango/ }).click()
    await counter.page.getByTestId('review-order').click()
    await counter.page.getByRole('dialog').getByTestId('send-order').click()
    await expect(counter.page).toHaveURL(/\/balcao\/comandas\/1$/)

    // 4. Na cozinha: um cartão para o pedido; "Começar" e "Pronto" avançam o pedido inteiro.
    const card = kitchen.page.getByTestId('order-card').filter({ hasText: customer })
    await expect(card).toHaveCount(1, { timeout: 5_000 })
    await expect(card.getByTestId('card-line')).toContainText('Espeto de frango')
    await card.getByTestId('advance-card').click()
    await expect(card.getByTestId('advance-card')).toContainText('Pronto')
    await card.getByTestId('advance-card').click()
    await expect(card).toHaveCount(0)

    // 5. Balcão entrega, pede a conta e recebe no Pix.
    const ready = counter.page.locator('[data-testid="tab-item"][data-stage="Pronto"]')
    await expect(ready).toBeVisible({ timeout: 5_000 })
    await ready.getByTestId('deliver').click()
    await counter.page.getByTestId('request-bill').click()
    await counter.page.getByTestId('receive').click()
    await expect(counter.page.getByTestId('receive-total')).toContainText('24,00')
    await counter.page.getByTestId('method-pix').click()
    await expect(counter.page.getByTestId('confirm-payment')).toContainText(
      'Confirmar R$ 24,00 no Pix',
    )
    await counter.page.getByTestId('confirm-payment').click()
    await expect(counter.page.getByTestId('tab-paid')).toBeVisible()

    // 6. Uma comanda fica aberta (o cliente volta amanhã).
    const pending = await api.post<{ id: string; number: number }>(`/units/${unit.id}/tabs`, {
      customerName: `Pendente ${suffix}`,
    })
    pendingTabId = pending.id

    // 7. Fechar o caixa pelo início: a comanda aberta não impede (RN-05.28).
    await counter.page.goto('/painel')
    await counter.page.getByTestId('close-cash').click()
    await expect(counter.page).toHaveURL(new RegExp(`/caixas/${registerId}/fechar$`))
    await expect(counter.page.getByTestId('pending-tabs')).toContainText(`Pendente ${suffix}`)
    await counter.page.getByLabel('Dinheiro conferido').fill('50,00')
    await counter.page.getByLabel('Pix conferido').fill('24,00')
    await counter.page.getByLabel('Crédito conferido').fill('0,00')
    await counter.page.getByLabel('Débito conferido').fill('0,00')
    await expect(counter.page.getByTestId('difference-pix')).toContainText('Confere')
    await counter.page.getByTestId('review-close').click()
    await expect(counter.page.getByTestId('confirm-close')).toContainText('1 comanda segue aberta')
    await counter.page.getByTestId('confirm-close-register').click()
    const summary = counter.page.getByTestId('closing-summary')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('24,00')
    // O dono vê o link do relatório do caixa (RN-07.07).
    await expect(counter.page.getByTestId('session-report')).toBeVisible()

    // 8. De volta ao início: caixa fechado de novo; a comanda pendente segue aberta.
    await counter.page.getByTestId('back-home').click()
    await expect(home).toHaveAttribute('data-state', 'open-cash')
    const tab = await api.get<{ status: string }>(`/tabs/${pending.id}`)
    expect(tab.status).toBe('open')
  } finally {
    await counter.context.close()
    await kitchen.context.close()
    if (pendingTabId) await api.post(`/tabs/${pendingTabId}/cancel`, {}).catch(() => undefined)
    // Unidade de teste: fecha o caixa se ficou aberto e desativa.
    const left = await api.get<{ data: { session: { id: string; status: string } | null }[] }>(
      `/units/${unit.id}/cash-registers`,
    )
    for (const register of left.data) {
      if (register.session?.status !== 'open') continue
      await api
        .post(`/cash-register-sessions/${register.session.id}/close`, {
          counts: ['cash', 'pix', 'credit_card', 'debit_card'].map((method) => ({
            method,
            informedCents: 0,
          })),
          note: 'limpeza do teste',
          finishPendingItems: true,
          finishEvent: false,
        })
        .catch(() => undefined)
    }
    await api.request
      .patch(`${apiBaseUrl}/api/v1/units/${unit.id}`, { data: { active: false } })
      .catch(() => undefined)
  }
})
