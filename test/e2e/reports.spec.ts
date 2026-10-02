import { expect, test } from '@playwright/test'
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
 * Relatórios (spec 07) contra a API real, com o seed (turno aberto na Barraca da Praça e um
 * caixa aberto): o histórico mostra o turno em andamento e o relatório dele, parcial.
 */

let api: OwnerApi

test.beforeAll(async () => {
  await expectApiUp()
  api = await ownerApi()
})

test.afterAll(async () => {
  await api?.request.dispose()
})

test.beforeEach(async ({ browserName, context }) => {
  skipWithoutSessionCookies(browserName)
  await hideDevtools(context)
})

async function call<T = never>(method: 'GET' | 'POST', path: string, data?: unknown) {
  const response = await api.request.fetch(`${apiBaseUrl}/api/v1${path}`, {
    method,
    data: data as never,
    headers: method === 'GET' ? {} : { 'Idempotency-Key': crypto.randomUUID() },
  })
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true)
  return (await response.json()) as T
}

test('o dono abre o histórico e o relatório parcial do turno aberto (RN-07.06, RN-07.07)', async ({
  page,
}) => {
  // Uma comanda paga no turno do seed, para o relatório ter venda e recebido.
  const tab = await api.createTab(`Relatório ${runSuffix()}`)
  await api.createOrder(tab.id, [{ product: 'Mandioca frita', quantity: 2 }])
  await call('POST', `/tabs/${tab.id}/request-bill`, {})
  const registers = await call<{ data: { id: string; status: string }[] }>(
    'GET',
    `/shifts/${api.shiftId}/cash-registers`,
  )
  const register = registers.data.find((item) => item.status === 'open')
  expect(register, 'o turno precisa de um caixa aberto').toBeDefined()
  await call('POST', `/tabs/${tab.id}/payments`, {
    method: 'pix',
    amountCents: 3_000,
    cashRegisterId: register!.id,
  })

  await loginOwner(page)
  await page
    .getByRole('link', { name: /Relatórios/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/painel\/relatorios$/)
  await expect(page.getByRole('button', { name: '30 dias' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByTestId('period-totals')).toContainText('Venda')

  const row = page.getByTestId('history-row').filter({ hasText: 'Em andamento' }).first()
  await expect(row).toBeVisible()
  await row.click()
  await expect(page).toHaveURL(new RegExp(`/painel/relatorios/turnos/${api.shiftId}$`))
  await expect(page.getByTestId('report-partial')).toContainText(
    'Turno em andamento — valores parciais',
  )
  await expect(page.getByTestId('report-summary')).toContainText('Venda')

  const products = page.getByTestId('report-products')
  await products.getByText('Por produto').click()
  await expect(products).toContainText('Mandioca frita')
  const payments = page.getByTestId('report-payments')
  await payments.getByText('Por forma de pagamento').click()
  await expect(payments.getByRole('row', { name: /^Pix/ })).toBeVisible()

  await page.getByRole('link', { name: 'Histórico' }).click()
  await expect(page).toHaveURL(/\/painel\/relatorios/)
})

test('colaborador não entra nos relatórios (RN-07.07)', async ({ page }) => {
  await loginStaffByLink(page)
  await page.goto('/painel/relatorios')
  await expect(page).toHaveURL(/\/estacoes$/)
})
