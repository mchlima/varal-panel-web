import { expect, test } from '@playwright/test'
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
 * Relatórios (spec 07) contra a API real, com o seed ("Caixa 1" aberto na Barraca da Praça):
 * o histórico mostra o dia em andamento, o relatório do dia (parcial) e o do caixa.
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

test('o dono vê o dia em andamento, o relatório do dia e o do caixa (RN-07.06, RN-07.07)', async ({
  page,
}) => {
  // Uma comanda paga no caixa aberto, para o relatório ter venda e recebido.
  await api.ensureRegisterOpen()
  const tab = await api.createTab(`Relatório ${runSuffix()}`)
  await api.createOrder(tab.id, [{ product: 'Mandioca frita', quantity: 2 }])
  await api.post(`/tabs/${tab.id}/request-bill`, {})
  const detail = await api.get<{ balanceCents: number }>(`/tabs/${tab.id}`)
  await api.post(`/tabs/${tab.id}/payments`, {
    method: 'pix',
    amountCents: detail.balanceCents,
    cashRegisterId: api.cashRegisterId,
  })

  await loginOwner(page)
  await page.goto('/painel/relatorios')
  await expect(page.getByTestId('period-30d')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('period-totals')).toContainText('Venda')

  // Dias: o dia de hoje, em andamento, abre o relatório do dia.
  const day = page.getByTestId('history-row').filter({ hasText: 'Em andamento' }).first()
  await expect(day).toBeVisible()
  await day.click()
  await expect(page).toHaveURL(/\/painel\/relatorios\/periodo\?unidade=.+&de=.+&ate=.+/)
  await expect(page.getByTestId('report-partial')).toContainText('Em andamento — valores parciais')
  await expect(page.getByTestId('report-summary')).toContainText('Venda')
  const products = page.getByTestId('report-products')
  await products.getByText('Por produto').click()
  await expect(products).toContainText('Mandioca frita')
  const payments = page.getByTestId('report-payments')
  await payments.getByText('Por forma de pagamento').click()
  await expect(payments.getByRole('row', { name: /^Pix/ })).toBeVisible()

  // Caixas: o "Caixa 1" aberto abre o relatório da abertura, sem venda (RN-07.09).
  await page.getByRole('link', { name: 'Histórico' }).click()
  await page.getByTestId('tab-caixas').click()
  const register = page.getByTestId('history-row').filter({ hasText: 'Caixa 1' }).first()
  await register.click()
  await expect(page).toHaveURL(/\/painel\/relatorios\/caixas\/[\w-]+$/)
  await expect(page.getByTestId('report-summary')).toContainText('Recebido')
  await expect(page.getByTestId('report-summary')).not.toContainText('Venda')
  const sessionPayments = page.getByTestId('report-payments')
  await sessionPayments.getByText('Pagamentos').first().click()
  await expect(sessionPayments).toContainText(`Comanda ${tab.number}`)
})

test('colaborador não entra nos relatórios (RN-07.07)', async ({ page }) => {
  // `ana` opera caixa: tem painel, mas não relatórios; volta ao início do painel.
  await loginStaffByLink(page)
  await page.goto('/painel/relatorios')
  await expect(page).toHaveURL(/\/painel$/)
})
