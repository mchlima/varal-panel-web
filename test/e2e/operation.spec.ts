import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  expectApiUp,
  hideDevtools,
  loginStaffByLink,
  ownerApi,
  runSuffix,
  skipWithoutSessionCookies,
  type OwnerApi,
} from './fixtures'

/**
 * Balcão e estações (spec 04) contra a API real, com dois aparelhos (dois contextos): balcão
 * (ana, que opera caixa e entra pelo painel) e cozinha (bruno, que só tem a Cozinha e entra direto
 * nela, RN-01.26). Precisa do seed com o "Caixa 1" aberto na Barraca da Praça.
 */

let api: OwnerApi

test.beforeAll(async () => {
  await expectApiUp()
  api = await ownerApi()
  await api.ensureRegisterOpen()
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

/** Cozinha: o bruno só tem ela e entra direto (RN-01.26). */
async function openKitchen(page: Page) {
  await loginStaffByLink(page, 'bruno', /\/estacao\/[\w-]+$/)
  await expect(page.getByTestId('realtime-status')).toContainText('Conectado')
}

/** Balcão: a ana opera caixa, entra no painel e toca em "Abrir balcão" (RN-01.24). */
async function openCounter(page: Page) {
  await loginStaffByLink(page, 'ana', /\/painel$/)
  await page.getByTestId('primary-action').click()
  await expect(page).toHaveURL(/\/balcao$/)
  await expect(page.getByTestId('realtime-status')).toContainText('Conectado')
}

/** Cartão do pedido na estação (um pedido, um cartão; RN-04.40). */
function orderCard(page: Page, customer: string) {
  return page.getByTestId('order-card').filter({ hasText: customer })
}

function cardLine(page: Page, customer: string, product: string) {
  return orderCard(page, customer).getByTestId('card-line').filter({ hasText: product })
}

test('balcão envia o pedido, a cozinha recebe em até 2 s, avança parte e o balcão entrega (CA-04.03, CA-04.04, CA-04.13)', async ({
  browser,
  baseURL,
}) => {
  const customer = `Cliente ${runSuffix()}`
  const counter = await device(browser, baseURL)
  const kitchen = await device(browser, baseURL)
  try {
    await openKitchen(kitchen.page)
    await openCounter(counter.page)

    // Nova comanda: com rede, a tela vai direto para o pedido da comanda nova.
    await counter.page.getByTestId('new-tab').click()
    await counter.page.getByLabel('Nome do cliente').fill(customer)
    await counter.page.getByRole('button', { name: 'Abrir comanda' }).click()
    await expect(counter.page).toHaveURL(/\/balcao\/comandas\/\d+\/pedido$/)

    // Espeto com "Ponto da carne" obrigatório: sem escolha não adiciona (CA-03.06).
    await counter.page.getByRole('button', { name: /^Espeto de carne/ }).click()
    const sheet = counter.page.getByRole('dialog')
    await sheet.getByTestId('add-to-order').click()
    await expect(sheet.getByRole('alert')).toContainText('Escolha uma opção em Ponto da carne')
    await sheet.getByRole('button', { name: /Ao ponto/ }).click()
    await sheet.getByRole('button', { name: /Pão de alho/ }).click()
    await sheet.getByRole('button', { name: 'Aumentar quantidade' }).click()
    await sheet.getByRole('button', { name: 'Aumentar quantidade' }).click()
    await sheet.getByLabel('Observação').fill('bem tostado')
    // (12,00 + 3,00) × 3
    await expect(sheet.getByTestId('add-to-order')).toContainText('R$ 45,00')
    await sheet.getByTestId('add-to-order').click()

    await counter.page.getByTestId('review-order').click()
    const review = counter.page.getByRole('dialog')
    await expect(review.getByTestId('cart-total')).toHaveText('R$ 45,00')
    const sent = counter.page.waitForResponse(
      (r) => r.url().includes('/orders') && r.request().method() === 'POST',
    )
    await review.getByTestId('send-order').click()
    const response = await sent
    expect(response.status()).toBe(201)
    expect(response.request().headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
    await expect(counter.page).toHaveURL(/\/balcao\/comandas\/\d+$/)

    // CA-04.03: chega à cozinha em até 2 segundos, sem recarregar, num cartão só (RN-04.40).
    const card = orderCard(kitchen.page, customer)
    await expect(card).toBeVisible({ timeout: 2_000 })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('3')
    await expect(card).toContainText('Ao ponto')
    await expect(card).toContainText('bem tostado')
    await expect(card.getByTestId('card-status')).toContainText('Novo')

    // Avançar parte (RN-04.24, CA-04.13): 2 de 3 vão para Preparando; 1 fica em Recebido. As
    // duas linhas continuam no mesmo cartão.
    const line = cardLine(kitchen.page, customer, 'Espeto de carne')
    await line.getByTestId('line-menu').click()
    await card.getByTestId('advance-part').click()
    await card.getByTestId('advance-2').click()
    await expect(card).toHaveCount(1)
    await expect(line).toHaveCount(2)
    await expect(card.getByTestId('card-line').filter({ hasText: 'Recebido' })).toContainText('1')
    await expect(card.getByTestId('card-line').filter({ hasText: 'Preparando' })).toContainText('2')

    // CA-04.04: o balcão vê as duas linhas em até 2 segundos; o total não muda.
    const items = counter.page.getByTestId('tab-item')
    await expect(items).toHaveCount(2, { timeout: 2_000 })
    await expect(
      counter.page.locator('[data-testid="tab-item"][data-stage="Preparando"]'),
    ).toContainText('2×')
    await expect(counter.page.getByTestId('tab-total')).toHaveText('R$ 45,00')

    // Os 2 ficam prontos: a linha sai da cozinha e fica riscada no cartão (RN-04.41).
    await card
      .getByTestId('card-line')
      .filter({ hasText: 'Preparando' })
      .getByTestId('line-advance')
      .click()
    await expect(card.locator('[data-testid="card-line"][data-state="done"]')).toHaveCount(1)
    await expect(card).toHaveCount(1)

    // RN-04.21: o balcão registra a entrega na comanda.
    const ready = counter.page.locator('[data-testid="tab-item"][data-stage="Pronto"]')
    await expect(ready).toBeVisible({ timeout: 2_000 })
    await ready.getByTestId('deliver').click()
    await expect(
      counter.page.locator('[data-testid="tab-item"][data-stage="Entregue"]'),
    ).toContainText('2×')
  } finally {
    await counter.context.close()
    await kitchen.context.close()
  }
})

test('dois aparelhos avançam o mesmo item: um avança, o outro recebe o aviso (CA-04.05)', async ({
  browser,
  baseURL,
}) => {
  const customer = `Disputa ${runSuffix()}`
  const tab = await api.createTab(customer)
  await api.createOrder(tab.id, [{ product: 'Queijo coalho', quantity: 1 }])

  const first = await device(browser, baseURL)
  const second = await device(browser, baseURL)
  try {
    await openKitchen(first.page)
    await openKitchen(second.page)
    const firstCard = orderCard(first.page, customer)
    const secondCard = orderCard(second.page, customer)
    await expect(firstCard).toBeVisible()
    await expect(secondCard).toBeVisible()

    // O segundo aparelho toca "avançar" sem rede: a ação fica na fila com a versão que ele viu.
    await second.context.setOffline(true)
    await secondCard.getByTestId('line-advance').click()
    await expect(secondCard).toContainText('Na fila')

    // O primeiro avança antes.
    await firstCard.getByTestId('line-advance').click()
    await expect(firstCard.getByTestId('card-line')).toContainText('Preparando')

    // A rede volta: a API recusa a ação velha (ITEM_CHANGED) e o cartão mostra o estado atual.
    await second.context.setOffline(false)
    await expect(secondCard).toContainText('Outro aparelho mexeu', { timeout: 10_000 })
    await expect(secondCard.getByTestId('card-line')).toContainText('Preparando')

    // Um único avanço: o item está em Preparando, não em Pronto.
    const current = await api.getTab(tab.id)
    expect(current.orders[0]!.items.map((item) => item.stageName)).toEqual(['Preparando'])
  } finally {
    await first.context.close()
    await second.context.close()
  }
})

test('pedido feito sem rede fica na fila e chega à cozinha uma vez só quando a rede volta (CA-01.07, CA-04.12)', async ({
  browser,
  baseURL,
}) => {
  const customer = `Sem rede ${runSuffix()}`
  const tab = await api.createTab(customer)
  const counter = await device(browser, baseURL)
  const kitchen = await device(browser, baseURL)
  try {
    await openKitchen(kitchen.page)
    await openCounter(counter.page)
    await counter.page.goto(`/balcao/comandas/${tab.number}`)
    await expect(counter.page.getByText('Nenhum pedido ainda.')).toBeVisible()
    await counter.page.getByTestId('new-order').click()
    await expect(counter.page.getByRole('button', { name: /^Queijo coalho/ })).toBeVisible()

    await counter.context.setOffline(true)
    await counter.page.getByRole('button', { name: /^Queijo coalho/ }).click()
    await counter.page.getByRole('button', { name: /^Queijo coalho/ }).click()
    await counter.page.getByTestId('review-order').click()
    await counter.page.getByRole('dialog').getByTestId('send-order').click()

    // Estado honesto: o pedido aparece "Na fila" na comanda, fora do total.
    await expect(counter.page).toHaveURL(new RegExp(`/balcao/comandas/${tab.number}$`))
    const pending = counter.page.getByTestId('pending-order')
    await expect(pending).toContainText('Na fila')
    await expect(pending).toContainText('2×')
    await expect(counter.page.getByTestId('connection-banner')).toContainText(
      '1 ação aguardando envio',
    )
    await expect(orderCard(kitchen.page, customer)).toHaveCount(0)

    await counter.context.setOffline(false)
    await expect(pending).toHaveCount(0, { timeout: 15_000 })
    await expect(counter.page.getByTestId('tab-order')).toHaveCount(1)
    await expect(orderCard(kitchen.page, customer)).toHaveCount(1)

    // Uma vez só, mesmo com reenvio.
    const current = await api.getTab(tab.id)
    expect(current.orders).toHaveLength(1)
    expect(current.orders[0]!.items[0]!.quantity).toBe(2)
  } finally {
    await counter.context.close()
    await kitchen.context.close()
  }
})
