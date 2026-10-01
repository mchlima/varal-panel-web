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
 * Fechamento e caixa (spec 05) contra a API real. Precisa do seed com turno aberto na Barraca
 * da Praça e o "Caixa 1" da ana aberto. O teste do fechamento cria uma unidade nova (turno e
 * caixa próprios) e a desativa no fim, para não mexer no turno do seed.
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

async function post(path: string, data: unknown) {
  const response = await api.request.post(`${apiBaseUrl}/api/v1${path}`, {
    data: data as never,
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
  expect(response.ok(), `POST ${path}: ${await response.text()}`).toBe(true)
  return (await response.json()) as never
}

/** Digita um valor no teclado numérico da tela (dígitos em centavos). */
async function typeAmount(page: Page, digits: string) {
  for (const digit of digits) await page.getByTestId(`key-${digit}`).click()
}

/** Com mais de um caixa aberto (sobras de outra execução), escolhe o primeiro. */
async function chooseRegisterIfAsked(page: Page) {
  const option = page.getByTestId('register-option').first()
  if (await option.isVisible().catch(() => false)) await option.click()
}

test('recebe Pix parcial e dinheiro com troco: a comanda fica paga e sai do varal (CA-05.01, CA-05.02)', async ({
  browser,
  baseURL,
}) => {
  const customer = `Receber ${runSuffix()}`
  // R$ 80,00: 4 mandiocas (15,00) e 2 espetos de frango (10,00), já pedindo a conta.
  const tab = await api.createTab(customer)
  await api.createOrder(tab.id, [
    { product: 'Mandioca frita', quantity: 4 },
    { product: 'Espeto de frango', quantity: 2 },
  ])
  await post(`/tabs/${tab.id}/request-bill`, {})

  const counter = await device(browser, baseURL)
  try {
    await openStation(counter.page, 'ana', /^Balcão Balcão de pedidos/)
    const page = counter.page
    await page.getByTestId('tab-search').fill(customer)
    await page.getByTestId('tab-card').filter({ hasText: customer }).click()
    await page.getByTestId('receive').click()
    await expect(page).toHaveURL(new RegExp(`/balcao/comandas/${tab.number}/receber$`))
    await expect(page.getByTestId('receive-balance')).toHaveText('R$ 80,00')
    await chooseRegisterIfAsked(page)

    // Pix de R$ 50,00: o valor começa no saldo e o primeiro dígito o substitui.
    await page.getByTestId('method-pix').click()
    await expect(page.getByTestId('pad-amount')).toHaveText('R$ 80,00')
    await typeAmount(page, '5000')
    await expect(page.getByTestId('confirm-payment')).toHaveText('Confirmar R$ 50,00 no Pix')
    const pix = page.waitForResponse(
      (r) => r.url().endsWith(`/tabs/${tab.id}/payments`) && r.request().method() === 'POST',
    )
    await page.getByTestId('confirm-payment').click()
    const pixResponse = await pix
    expect(pixResponse.status()).toBe(201)
    expect(pixResponse.request().headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
    await expect(page.getByTestId('receive-balance')).toHaveText('R$ 30,00')
    await expect(page.getByTestId('receive-paid')).toHaveText('R$ 50,00')

    // Dinheiro: R$ 50,00 entregues para R$ 30,00 de saldo, troco de R$ 20,00 em destaque.
    await page.getByTestId('method-cash').click()
    await typeAmount(page, '5000')
    await expect(page.getByTestId('change')).toHaveText('R$ 20,00')
    await expect(page.getByTestId('confirm-payment')).toHaveText('Confirmar R$ 50,00 no dinheiro')
    await page.getByTestId('confirm-payment').click()
    await expect(page.getByTestId('tab-paid')).toBeVisible()
    await expect(page.getByTestId('last-change')).toHaveText('R$ 20,00')
    await expect(page.getByTestId('receive-balance')).toHaveText('R$ 0,00')
    await expect(page.getByTestId('payment-row')).toHaveCount(2)

    const current = (await api.getTab(tab.id)) as unknown as {
      status: string
      payments: { method: string; amountCents: number; changeCents: number | null }[]
    }
    expect(current.status).toBe('paid')
    expect(current.payments.map((p) => [p.method, p.amountCents, p.changeCents])).toEqual([
      ['pix', 5_000, null],
      ['cash', 3_000, 2_000],
    ])

    // RN-05.10: saiu do varal.
    await page.getByTestId('back-to-board').click()
    await expect(page).toHaveURL(/\/balcao$/)
    await page.getByTestId('tab-search').fill(customer)
    await expect(page.getByTestId('tab-card').filter({ hasText: customer })).toHaveCount(0)
  } finally {
    await counter.context.close()
  }
})

test('paga antes: o pedido só chega à cozinha depois de pago (CA-04.10, RN-05.12)', async ({
  browser,
  baseURL,
}) => {
  const customer = `Antes ${runSuffix()}`
  const counter = await device(browser, baseURL)
  const kitchen = await device(browser, baseURL)
  try {
    await openStation(kitchen.page, 'bruno', /Cozinha/)
    await openStation(counter.page, 'ana', /^Balcão Balcão de pedidos/)
    const page = counter.page

    await page.getByTestId('new-tab').click()
    await page.getByLabel('Paga antes').check()
    await page.getByLabel('Nome do cliente').fill(customer)
    await page.getByRole('button', { name: 'Montar pedido' }).click()
    await expect(page).toHaveURL(/\/balcao\/paga-antes/)

    await page.getByRole('button', { name: /^Queijo coalho/ }).click()
    await page.getByRole('button', { name: /^Queijo coalho/ }).click()
    await expect(page.getByTestId('review-order')).toContainText('R$ 18,00')
    await page.getByTestId('review-order').click()
    await page.getByRole('dialog').getByTestId('go-pay').click()
    await expect(page.getByTestId('pay-first-remaining')).toHaveText('R$ 18,00')
    await chooseRegisterIfAsked(page)

    // Montado e na tela de cobrar: nada na cozinha ainda.
    const card = kitchen.page.getByTestId('queue-item').filter({ hasText: customer })
    await kitchen.page.waitForTimeout(1_000)
    await expect(card).toHaveCount(0)

    await page.getByTestId('method-pix').click()
    await expect(page.getByTestId('confirm-pay-first')).toHaveText(
      'Confirmar R$ 18,00 no Pix e enviar',
    )
    const sent = page.waitForResponse(
      (r) => r.url().endsWith('/tabs/pay-first') && r.request().method() === 'POST',
    )
    await page.getByTestId('confirm-pay-first').click()
    expect((await sent).status()).toBe(201)
    await expect(page.getByTestId('pay-first-done')).toBeVisible()

    // Pago: o item chega à cozinha em até 2 s.
    await expect(card).toBeVisible({ timeout: 2_000 })
    await expect(card).toContainText('2×')
  } finally {
    await counter.context.close()
    await kitchen.context.close()
  }
})

test('caixa: abrir, suprimento, sangria, fechar com diferença exige observação e o turno fecha depois (CA-05.06, CA-05.07, RN-04.07)', async ({
  page,
}) => {
  const suffix = runSuffix()
  const created = await api.request.post(`${apiBaseUrl}/api/v1/units`, {
    data: { name: `Caixa ${suffix}`, lateAfterMinutes: 15 },
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const unit = (await created.json()) as { id: string }
  try {
    await post(`/units/${unit.id}/shifts`, { type: 'direct_sale' })
    await hideDevtools(page.context())
    await loginOwner(page)

    // Abrir caixa com troco inicial (RN-05.17).
    await page.goto(`/caixas?unidade=${unit.id}`)
    await page.getByTestId('new-register').click()
    await page.getByLabel('Nome (opcional)').fill(`Caixa E2E ${suffix}`)
    await page.getByLabel('Troco inicial').fill('100,00')
    await page.getByTestId('open-register').click()
    const card = page.getByTestId('register-card').filter({ hasText: `Caixa E2E ${suffix}` })
    await expect(card.getByTestId('expected-cash')).toHaveText('R$ 100,00')
    await expect(card).toContainText('Responsável: Você')

    // Suprimento e sangria com motivo (RN-05.18, RN-05.19).
    await card.getByTestId('deposit').click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('Valor').fill('50,00')
    await dialog.getByTestId('submit-movement').click()
    await expect(dialog.getByText('Diga o motivo.')).toBeVisible()
    await dialog.getByLabel('Motivo').fill('reforço de troco')
    await dialog.getByTestId('submit-movement').click()
    await expect(card.getByTestId('expected-cash')).toHaveText('R$ 150,00')
    await card.getByTestId('withdrawal').click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Valor').fill('30,00')
    await dialog.getByLabel('Motivo').fill('cofre')
    await dialog.getByTestId('submit-movement').click()
    await expect(card.getByTestId('expected-cash')).toHaveText('R$ 120,00')

    // Turno não fecha com caixa aberto (RN-04.07).
    await page.goto(`/painel/turnos?unidade=${unit.id}`)
    await expect(page.getByTestId('shift-registers')).toContainText('Caixas abertos: 1')
    await page.getByRole('button', { name: 'Fechar turno' }).click()
    await page
      .getByRole('group', { name: /Fechar o turno agora/ })
      .getByRole('button', { name: 'Fechar turno' })
      .click()
    await expect(page.getByTestId('shift-pending')).toContainText(`Caixa E2E ${suffix}`)

    // Fechar caixa: diferença calculada ao vivo e observação obrigatória (CA-05.07).
    await page.goto(`/caixas?unidade=${unit.id}`)
    await card.getByTestId('close-register-link').click()
    await expect(page).toHaveURL(/\/caixas\/[0-9a-f-]+\/fechar$/)
    await expect(page.getByTestId('count-expected-cash')).toHaveText('R$ 120,00')
    await page.getByLabel('Dinheiro conferido').fill('115,00')
    await expect(page.getByTestId('difference-cash')).toHaveText('Falta R$ 5,00')
    await page.getByLabel('Pix conferido').fill('0')
    await page.getByLabel('Crédito conferido').fill('0')
    await page.getByLabel('Débito conferido').fill('0')
    await expect(page.getByTestId('difference-pix')).toHaveText('Confere')
    await page.getByTestId('review-close').click()
    await expect(page.getByText('Há diferença: explique na observação.')).toBeVisible()
    await expect(page.getByTestId('confirm-close')).toHaveCount(0)
    await page.getByTestId('closing-note').fill('faltou troco de uma venda')
    await page.getByTestId('review-close').click()
    const closed = page.waitForResponse(
      (r) => r.url().endsWith('/close') && r.request().method() === 'POST',
    )
    await page.getByTestId('confirm-close-register').click()
    expect((await closed).status()).toBe(200)
    await expect(page.getByTestId('register-closed')).toBeVisible()
    await expect(page.getByText('Falta R$ 5,00')).toBeVisible()
    await expect(page.getByText('Observação: faltou troco de uma venda')).toBeVisible()

    // Com o caixa fechado, o turno fecha.
    await page.goto(`/painel/turnos?unidade=${unit.id}`)
    await expect(page.getByTestId('shift-registers')).toContainText('Caixas abertos: 0')
    await page.getByRole('button', { name: 'Fechar turno' }).click()
    await page
      .getByRole('group', { name: /Fechar o turno agora/ })
      .getByRole('button', { name: 'Fechar turno' })
      .click()
    await expect(page.getByText('Turno fechado.')).toBeVisible()
  } finally {
    await api.request.patch(`${apiBaseUrl}/api/v1/units/${unit.id}`, { data: { active: false } })
  }
})
