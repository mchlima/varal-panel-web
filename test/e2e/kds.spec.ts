import { expect, test, type Browser, type Page } from '@playwright/test'
import {
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
 * Estação no formato KDS (spec 04, seções 5.2 e 8.2) contra a API real: um pedido, um cartão
 * (RN-04.40, CA-04.20), avanço do pedido inteiro (CA-04.17), "Desfazer", "Adicional" (CA-04.22) e
 * a grade em toda a largura (CA-04.18). Precisa do seed com o "Caixa 1" aberto.
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

async function kitchen(browser: Browser, baseURL: string | undefined, width = 360) {
  const context = await browser.newContext({
    baseURL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width, height: width > 1000 ? 1080 : 780 },
    hasTouch: width <= 1000,
    isMobile: width <= 1000,
  })
  await hideDevtools(context)
  const page = await context.newPage()
  return { context, page }
}

function card(page: Page, customer: string) {
  return page.getByTestId('order-card').filter({ hasText: customer })
}

test('CA-04.20, CA-04.17: um cartão por pedido, linha riscada, pedido inteiro e desfazer', async ({
  browser,
  baseURL,
}) => {
  const { context, page } = await kitchen(browser, baseURL)
  // RN-01.26: o bruno só tem a Cozinha e entra direto nela, sem "Painel" nem "Trocar".
  await loginStaffByLink(page, 'bruno', /\/estacao\/[\w-]+$/)
  await expect(page.getByTestId('realtime-status')).toContainText('Conectado')
  await expect(page.getByTestId('go-panel')).toHaveCount(0)
  await expect(page.getByTestId('switch-station')).toHaveCount(0)

  const customer = `KDS ${runSuffix()}`
  const tab = await api.createTab(customer)
  await api.createOrder(tab.id, [
    { product: 'Espeto de carne', quantity: 2, modifiers: ['Ao ponto'] },
    { product: 'Pão de alho', quantity: 1 },
  ])

  const order = card(page, customer)
  await expect(order).toHaveCount(1)
  await expect(order.getByTestId('card-line')).toHaveCount(2)
  await expect(order.getByTestId('card-status')).toContainText('Novo')

  await order.getByTestId('advance-card').click()
  await expect(order.getByTestId('card-line').first()).toContainText('Preparando')

  // Tocar no pão de alho em Preparando o deixa riscado; o cartão continua.
  await order
    .getByTestId('card-line')
    .filter({ hasText: 'Pão de alho' })
    .getByTestId('line-advance')
    .click()
  await expect(order.getByTestId('card-line').filter({ hasText: 'Pão de alho' })).toHaveAttribute(
    'data-state',
    'done',
  )
  await expect(order).toHaveCount(1)

  await expect(order.getByTestId('advance-card')).toContainText('Pronto')
  await order.getByTestId('advance-card').click()
  await expect(order).toHaveCount(0)
  const undo = page.getByTestId('undo')
  await expect(undo).toContainText('Pronto')
  await undo.getByRole('button', { name: 'Desfazer' }).click()
  await expect(card(page, customer)).toHaveCount(1)

  // CA-04.22: um segundo pedido na mesma comanda é um cartão novo, "Adicional · pedido 2".
  await api.createOrder(tab.id, [{ product: 'Queijo coalho', quantity: 1 }])
  await expect(card(page, customer)).toHaveCount(2)
  await expect(card(page, customer).filter({ hasText: 'Adicional · pedido 2' })).toHaveCount(1)

  await context.close()
})

test('CA-04.18: numa tela de 1920 px, a grade ocupa a largura em pelo menos 5 colunas', async ({
  browser,
  baseURL,
}) => {
  const { context, page } = await kitchen(browser, baseURL, 1920)
  await loginOwner(page)
  await page.goto('/estacoes')
  await page.getByRole('button', { name: /Cozinha/ }).click()
  const grid = page.getByTestId('kds-grid')
  await expect(grid).toBeVisible()
  const columns = await grid.evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
  )
  expect(columns).toBeGreaterThanOrEqual(5)
  const box = await grid.boundingBox()
  expect(box!.width).toBeGreaterThan(1800)
  // CA-01.16: o dono volta ao painel com um toque em "Painel".
  await page.getByTestId('go-panel').click()
  await expect(page).toHaveURL(/\/painel$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/estacao\//)
  await context.close()
})
