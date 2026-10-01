import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  apiBaseUrl,
  expectApiUp,
  hideDevtools,
  loginOwner,
  loginStaffByLink,
  ownerApi,
  runSuffix,
  skipWithoutSessionCookies,
  type OwnerApi,
} from './fixtures'

/**
 * Turno, balcão e estações (spec 04) contra a API real, com dois aparelhos (dois contextos):
 * balcão (ana) e cozinha (bruno). Precisa do seed com turno aberto na Barraca da Praça.
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

async function openStation(page: Page, username: string, station: RegExp) {
  await loginStaffByLink(page, username)
  await page.getByRole('button', { name: station }).click()
  await expect(page.getByTestId('realtime-status')).toContainText('Conectado')
}

function queueCard(page: Page, customer: string, product: string) {
  return page
    .getByTestId('queue-item')
    .filter({ hasText: customer })
    .filter({ has: page.getByTestId('queue-item-title').filter({ hasText: product }) })
}

test('balcão envia o pedido, a cozinha recebe em até 2 s, avança parte e o balcão entrega (CA-04.03, CA-04.04, CA-04.13)', async ({
  browser,
  baseURL,
}) => {
  const customer = `Cliente ${runSuffix()}`
  const counter = await device(browser, baseURL)
  const kitchen = await device(browser, baseURL)
  try {
    await openStation(kitchen.page, 'bruno', /Cozinha/)
    await openStation(counter.page, 'ana', /^Balcão Balcão de pedidos/)
    await expect(counter.page).toHaveURL(/\/balcao$/)

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

    // CA-04.03: chega à cozinha em até 2 segundos, sem recarregar.
    const card = queueCard(kitchen.page, customer, 'Espeto de carne')
    await expect(card).toBeVisible({ timeout: 2_000 })
    await expect(card).toContainText('3×')
    await expect(card).toContainText('Ao ponto')
    await expect(card).toContainText('Obs.: bem tostado')
    await expect(card).toContainText('Novo')

    // Avançar parte (RN-04.24, CA-04.13): 2 de 3 vão para Preparando; 1 fica em Recebido.
    await card.getByTestId('item-menu').click()
    await card.getByTestId('advance-part').click()
    await card.getByTestId('advance-2').click()
    const cards = kitchen.page.getByTestId('queue-item').filter({ hasText: customer })
    const inStage = (stage: string) =>
      kitchen.page
        .locator(`[data-testid="queue-item"][data-stage="${stage}"]`)
        .filter({ hasText: customer })
    await expect(cards).toHaveCount(2)
    await expect(inStage('Recebido')).toContainText('1×')
    await expect(inStage('Preparando')).toContainText('2×')

    // CA-04.04: o balcão vê as duas linhas em até 2 segundos; o total não muda.
    const items = counter.page.getByTestId('tab-item')
    await expect(items).toHaveCount(2, { timeout: 2_000 })
    await expect(
      counter.page.locator('[data-testid="tab-item"][data-stage="Preparando"]'),
    ).toContainText('2×')
    await expect(counter.page.getByTestId('tab-total')).toHaveText('R$ 45,00')

    // Os 2 ficam prontos: saem da cozinha e vão para o Balcão de entrega.
    await inStage('Preparando').getByTestId('advance').click()
    await expect(cards).toHaveCount(1)

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
    await openStation(first.page, 'bruno', /Cozinha/)
    await openStation(second.page, 'bruno', /Cozinha/)
    const firstCard = queueCard(first.page, customer, 'Queijo coalho')
    const secondCard = queueCard(second.page, customer, 'Queijo coalho')
    await expect(firstCard).toBeVisible()
    await expect(secondCard).toBeVisible()

    // O segundo aparelho toca "avançar" sem rede: a ação fica na fila com a versão que ele viu.
    await second.context.setOffline(true)
    await secondCard.getByTestId('advance').click()
    await expect(secondCard).toContainText('Na fila')

    // O primeiro avança antes.
    await firstCard.getByTestId('advance').click()
    await expect(firstCard).toHaveAttribute('data-stage', 'Preparando')

    // A rede volta: a API recusa a ação velha (ITEM_CHANGED) e o cartão mostra o estado atual.
    await second.context.setOffline(false)
    await expect(secondCard).toContainText('Outro aparelho mexeu neste item antes', {
      timeout: 10_000,
    })
    await expect(secondCard).toHaveAttribute('data-stage', 'Preparando')
    await secondCard.getByRole('button', { name: 'Entendi' }).click()

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
    await openStation(kitchen.page, 'bruno', /Cozinha/)
    await openStation(counter.page, 'ana', /^Balcão Balcão de pedidos/)
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
    await expect(queueCard(kitchen.page, customer, 'Queijo coalho')).toHaveCount(0)

    await counter.context.setOffline(false)
    await expect(pending).toHaveCount(0, { timeout: 15_000 })
    await expect(counter.page.getByTestId('tab-order')).toHaveCount(1)
    await expect(queueCard(kitchen.page, customer, 'Queijo coalho')).toHaveCount(1)

    // Uma vez só, mesmo com reenvio.
    const current = await api.getTab(tab.id)
    expect(current.orders).toHaveLength(1)
    expect(current.orders[0]!.items[0]!.quantity).toBe(2)
  } finally {
    await counter.context.close()
    await kitchen.context.close()
  }
})

test('fechar o turno é recusado com comanda aberta e mostra as pendências (CA-04.09)', async ({
  page,
}) => {
  await loginOwner(page)
  await page.goto('/painel/turnos')
  await expect(page.getByTestId('current-shift')).toContainText('Turno aberto')
  await page.getByRole('button', { name: 'Fechar turno' }).click()
  await page
    .getByRole('group', { name: /Fechar o turno agora/ })
    .getByRole('button', { name: 'Fechar turno' })
    .click()
  const pendingList = page.getByTestId('shift-pending')
  await expect(pendingList).toContainText('Ainda há comandas')
  await expect(pendingList.getByRole('link', { name: /Dona Marta/ })).toBeVisible()
  // O turno continua aberto.
  await page.reload()
  await expect(page.getByTestId('current-shift')).toContainText('Turno aberto')
})

test('dono abre turno contratado com o acordo e fecha sem pendências (RN-04.04 a RN-04.07)', async ({
  page,
}) => {
  // Unidade nova, sem turno (a do seed já tem um aberto); desativada no fim.
  const suffix = runSuffix()
  const created = await api.request.post(`${apiBaseUrl}/api/v1/units`, {
    data: { name: `Evento ${suffix}`, lateAfterMinutes: 15 },
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const unit = (await created.json()) as { id: string }
  try {
    await hideDevtools(page.context())
    await loginOwner(page)
    await page.goto(`/painel/turnos?unidade=${unit.id}`)
    await expect(page.getByRole('heading', { name: 'Abrir turno' })).toBeVisible()
    await page.getByLabel('Turno contratado').check()
    // Contratante obrigatório (RN-04.05).
    await page.getByTestId('open-shift').click()
    await expect(page.getByText('Informe o nome do contratante.')).toBeVisible()
    await page.getByLabel('Contratante', { exact: true }).fill(`Festa ${suffix}`)
    await page.getByLabel('Valor combinado (opcional)').fill('1.500,00')
    const opened = page.waitForResponse(
      (r) => r.url().endsWith('/shifts') && r.request().method() === 'POST',
    )
    await page.getByTestId('open-shift').click()
    expect((await opened).status()).toBe(201)
    const current = page.getByTestId('current-shift')
    await expect(current).toContainText('Turno contratado')
    await expect(current).toContainText(`Acordo com Festa ${suffix}`)
    await expect(current).toContainText('R$ 1.500,00')

    // Fechar sem comandas: aceito, e a tela volta para "Abrir turno".
    await page.getByRole('button', { name: 'Fechar turno' }).click()
    await page
      .getByRole('group', { name: /Fechar o turno agora/ })
      .getByRole('button', { name: 'Fechar turno' })
      .click()
    await expect(page.getByText('Turno fechado.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Abrir turno' })).toBeVisible()
  } finally {
    await api.request.patch(`${apiBaseUrl}/api/v1/units/${unit.id}`, { data: { active: false } })
  }
})
