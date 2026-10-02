import { expect, test } from '@playwright/test'
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
 * Caixas da unidade (spec 05, seções 5 e 8) contra a API real. Para não mexer no "Caixa 1" do
 * seed, o teste cria uma unidade nova (que nasce com o próprio "Caixa 1", RN-03.03), abre,
 * movimenta, fecha com uma comanda pendente, reabre e, no fim, cancela a comanda e desativa a
 * unidade.
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

interface Register {
  id: string
  name: string
  session: { id: string; status: string } | null
}

test('abre o caixa, faz sangria, fecha com comanda pendente e reabre (CA-05.06, CA-05.11, CA-05.12)', async ({
  page,
  context,
}) => {
  await hideDevtools(context)
  const unitName = `Caixa E2E ${runSuffix()}`
  const unit = await api.post<{ id: string; version: number }>('/units', {
    name: unitName,
    lateAfterMinutes: 15,
  })
  const registers = await api.get<{ data: Register[] }>(`/units/${unit.id}/cash-registers`)
  // CA-03.11: unidade nova nasce com o "Caixa 1".
  expect(registers.data.map((register) => register.name)).toEqual(['Caixa 1'])
  const registerId = registers.data[0]!.id

  await loginOwner(page)
  await page.goto('/caixas')
  await page.getByRole('button', { name: unitName }).click()

  // Fechado: um único caixa, "Abrir" é a ação principal.
  const card = page.getByTestId('register-card')
  await expect(card).toHaveAttribute('data-state', 'never')
  await card.getByTestId('open-register').click()
  await expect(page).toHaveURL(new RegExp(`/caixas/${registerId}/abrir$`))
  await page.getByLabel('Troco inicial na gaveta').fill('100,00')
  await page.getByTestId('confirm-open').click()
  await expect(page).toHaveURL(/\/painel$/)

  // CA-05.06 (parte da tela): sangria de R$ 20,00 baixa o esperado em dinheiro.
  await page.goto(`/caixas?unidade=${unit.id}`)
  await expect(page.getByTestId('expected-cash')).toContainText('100,00')
  await page.getByTestId('withdrawal').click()
  await page.getByLabel('Valor').fill('20,00')
  await page.getByLabel('Motivo').fill('Cofre')
  await page.getByTestId('submit-movement').click()
  await expect(page.getByTestId('expected-cash')).toContainText('80,00')

  // RN-05.28 / CA-05.11: uma comanda aberta não impede fechar e aparece como pendente.
  const tab = await api.post<{ id: string; number: number }>(`/units/${unit.id}/tabs`, {
    customerName: 'Pendente E2E',
  })
  await page.getByTestId('close-register-link').click()
  await expect(page.getByTestId('pending-tab')).toContainText('Pendente E2E')
  const amounts = ['80,00', '0', '0', '0']
  const fields = page.locator('input[inputmode="decimal"]')
  for (const [index, value] of amounts.entries()) await fields.nth(index).fill(value)
  await page.getByTestId('review-close').click()
  await page.getByTestId('confirm-close-register').click()
  await expect(page.getByTestId('register-closed')).toBeVisible()
  await expect(page.getByTestId('closing-summary')).toContainText('Confere')
  await expect(page.getByTestId('session-report')).toBeVisible()

  const afterClose = await api.get<{ data: Register[] }>(`/units/${unit.id}/cash-registers`)
  const firstSession = afterClose.data[0]!.session!
  expect(firstSession.status).toBe('closed')
  const tabAfter = await api.get<{ status: string }>(`/tabs/${tab.id}`)
  expect(tabAfter.status).toBe('open')

  // CA-05.12: abrir de novo cria outra abertura; a anterior não muda.
  await page.goto(`/caixas/${registerId}/abrir`)
  await expect(page.getByLabel('Troco inicial na gaveta')).toHaveValue('100,00')
  await page.getByTestId('confirm-open').click()
  await expect(page).toHaveURL(/\/painel$/)
  const reopened = await api.get<{ data: Register[] }>(`/units/${unit.id}/cash-registers`)
  expect(reopened.data[0]!.session!.status).toBe('open')
  expect(reopened.data[0]!.session!.id).not.toBe(firstSession.id)

  // Limpeza: fecha o caixa, cancela a comanda vazia e desativa a unidade.
  await api.post(`/cash-register-sessions/${reopened.data[0]!.session!.id}/close`, {
    counts: [
      { method: 'cash', informedCents: 10_000 },
      { method: 'pix', informedCents: 0 },
      { method: 'credit_card', informedCents: 0 },
      { method: 'debit_card', informedCents: 0 },
    ],
  })
  await api.post(`/tabs/${tab.id}/cancel`, {})
  const current = await api.get<{ data: { id: string; version: number }[] }>('/units?limit=100')
  const version = current.data.find((item) => item.id === unit.id)!.version
  const response = await api.request.patch(`${apiBaseUrl}/api/v1/units/${unit.id}`, {
    data: { active: false, version },
  })
  expect(response.ok(), await response.text()).toBe(true)
})

test('cadastro de caixas: cria, renomeia e recusa desativar o último ativo (CA-05.14)', async ({
  page,
  context,
}) => {
  await hideDevtools(context)
  const unitName = `Cadastro E2E ${runSuffix()}`
  const unit = await api.post<{ id: string }>('/units', { name: unitName, lateAfterMinutes: 15 })

  try {
    await loginOwner(page)
    await page.goto(`/painel/unidades/${unit.id}/caixas`)
    await expect(page.getByTestId('register-row')).toHaveCount(1)

    // Desativar o único caixa ativo é recusado e explicado.
    await page.getByRole('button', { name: 'Desativar' }).click()
    await page.getByRole('button', { name: 'Desativar caixa' }).click()
    await expect(page.getByText('pelo menos um caixa ativo')).toBeVisible()

    await page.getByTestId('new-register-form').getByLabel('Nome do caixa').fill('Caixa 2')
    await page.getByTestId('create-register').click()
    await expect(page.getByTestId('register-row')).toHaveCount(2)
    await expect(page.locator('[data-register-name="Caixa 2"]')).toBeVisible()
  } finally {
    // Unidade só do teste: sai da lista para não virar "mais de uma unidade" nos outros testes.
    await api.request.patch(`${apiBaseUrl}/api/v1/units/${unit.id}`, { data: { active: false } })
  }
})
