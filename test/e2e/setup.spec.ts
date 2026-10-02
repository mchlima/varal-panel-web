import { expect, test } from '@playwright/test'
import {
  apiBaseUrl,
  expectApiUp,
  loginOwner,
  loginStaffByLink,
  ownerApi,
  skipWithoutSessionCookies,
} from './fixtures'

/**
 * Configuração da unidade (spec 03) contra a API real com o seed: o dono cria estação, edita
 * o fluxo, cria produto com modificador e marca esgotado; o colaborador vê só as estações
 * liberadas e recebe o esgotado em tempo real. Nomes com sufixo para a suíte poder rodar de
 * novo no mesmo banco.
 */
const suffix = Date.now().toString(36).slice(-5)

test.beforeAll(async () => {
  await expectApiUp()
})

test.beforeEach(({ browserName }) => skipWithoutSessionCookies(browserName))

test('dono cria estação e edita o fluxo da unidade (RN-03.05, RN-03.06)', async ({ page }) => {
  const station = `Fritadeira ${suffix}`
  const stage = `Fritando ${suffix}`
  // A Barraca da Praça do seed tem caixa aberto (spec 05), e com caixa aberto o fluxo trava
  // (RN-03.07). O teste usa uma unidade nova, sem caixa aberto, desativada no fim.
  const api = await ownerApi()
  const created = await api.request.post(`${apiBaseUrl}/api/v1/units`, {
    data: { name: `Unidade ${suffix}`, lateAfterMinutes: 15 },
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const unit = (await created.json()) as { id: string; version: number }
  try {
    await loginOwner(page)
    await page.goto(`/painel/unidades/${unit.id}/fluxo`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Estações e fluxo')
    await editWorkflow(page, station, stage)
  } finally {
    await api.request.patch(`${apiBaseUrl}/api/v1/units/${unit.id}`, { data: { active: false } })
    await api.request.dispose()
  }
})

async function editWorkflow(page: import('@playwright/test').Page, station: string, stage: string) {
  // Estação nova (fila).
  await page.getByRole('button', { name: 'Nova estação' }).click()
  const form = page.getByRole('form', { name: 'Nova estação' })
  await form.getByLabel('Nome da estação').fill(station)
  await form.getByRole('button', { name: 'Criar estação' }).click()
  await expect(page.getByTestId('station-row').filter({ hasText: station })).toBeVisible()

  // Etapa nova antes da final, numa estação fixa: a nova fritadeira.
  const stages = page.getByTestId('workflow-stages').locator(':scope > li')
  const before = await stages.count()
  await page.getByRole('button', { name: 'Adicionar etapa' }).click()
  await expect(stages).toHaveCount(before + 1)
  const added = stages.nth(before - 1)
  await added.getByLabel('Nome da etapa').fill(stage)
  await added.getByLabel('Onde o item aparece').selectOption('fixed_station')
  // Validação local: sem estação, mostra o problema e não salva.
  await page.getByRole('button', { name: 'Salvar fluxo' }).click()
  await expect(added).toContainText('Escolha a estação em que o item aparece nesta etapa.')
  await added.getByLabel('Estação', { exact: true }).selectOption({ label: station })
  // Estação de balcão nem aparece como opção (RN-03.06).
  const options = await added
    .getByLabel('Estação', { exact: true })
    .locator('option')
    .allTextContents()
  expect(options.map((o) => o.trim())).not.toContain('Balcão')
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/workflow') && r.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: 'Salvar fluxo' }).click()
  expect((await saved).status()).toBe(200)
  await expect(page.getByText('Fluxo salvo.')).toBeVisible()

  // Depois de recarregar, a etapa continua lá; tirá-la do fluxo a arquiva na API.
  await page.reload()
  await expect(stages.nth(before - 1).getByLabel('Nome da etapa')).toHaveValue(stage)
  await page.getByRole('button', { name: `Tirar etapa ${before} do fluxo` }).click()
  await page.getByRole('button', { name: 'Salvar fluxo' }).click()
  await expect(page.getByText('Fluxo salvo.')).toBeVisible()
  await expect(stages).toHaveCount(before)
}

test('dono cria produto com modificador e marca esgotado; o colaborador da cozinha vê na hora (CA-03.05)', async ({
  page,
  browser,
  baseURL,
}) => {
  const product = `Espeto teste ${suffix}`
  await loginOwner(page)
  await page.goto('/painel/cardapio')
  await page.getByRole('tab', { name: 'Espetos' }).click()
  await page.getByRole('button', { name: 'Novo produto em Espetos' }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nome', { exact: true }).fill(product)
  await dialog.getByLabel('Preço').fill('13,5')
  await dialog.getByRole('button', { name: 'Criar produto' }).click()
  await expect(dialog.getByRole('heading', { name: 'Modificadores' })).toBeVisible()

  // Grupo obrigatório (mínimo 1) com acréscimo em reais.
  await dialog.getByRole('button', { name: 'Novo grupo de modificadores' }).click()
  const group = dialog.getByRole('form', { name: 'Novo grupo de modificadores' })
  await group.getByLabel('Nome do grupo').fill('Ponto da carne')
  await group.getByLabel('Mínimo de escolhas').fill('1')
  await group.getByLabel('Máximo de escolhas').fill('1')
  await group.getByLabel('Opção 1', { exact: true }).fill('Ao ponto')
  await group.getByRole('button', { name: 'Mais uma opção' }).click()
  await group.getByLabel('Opção 2', { exact: true }).fill('Bem passado')
  await group.getByLabel('Acréscimo').nth(1).fill('2,00')
  await group.getByRole('button', { name: 'Criar grupo' }).click()
  const created = dialog.getByTestId('modifier-group')
  await expect(created).toContainText('Ponto da carne')
  await expect(created).toContainText('Obrigatório, escolha 1')
  await expect(created).toContainText('Bem passado')
  await expect(created).toContainText('+ R$ 2,00')
  await dialog.getByRole('button', { name: 'Fechar' }).click()

  const row = page.getByTestId('product-row').filter({ hasText: product })
  await expect(row).toContainText('R$ 13,50')
  await expect(row).toContainText('1 grupo de modificadores')

  // Colaborador da cozinha (bruno) com a estação aberta noutro aparelho.
  const staffContext = await browser.newContext({ baseURL, locale: 'pt-BR' })
  const staff = await staffContext.newPage()
  try {
    // O bruno só tem a Cozinha: entra direto nela (RN-01.26).
    await loginStaffByLink(staff, 'bruno', /\/estacao\/[0-9a-f-]{36}$/)
    await expect(staff.getByTestId('realtime-status')).toContainText('Conectado')
    // Atalho de esgotado da estação (spec 03, seção 9), aberto pelo cabeçalho da fila.
    await staff.getByRole('button', { name: 'Esgotados' }).click()
    const staffToggle = staff.getByRole('button', { name: `Esgotado: ${product}` })
    await expect(staffToggle).toHaveAttribute('aria-pressed', 'false')

    // Dono marca esgotado no cardápio (vai pela fila offline com Idempotency-Key).
    const sent = page.waitForResponse(
      (r) => r.url().endsWith('/sold-out') && r.request().method() === 'POST',
    )
    await row.getByRole('button', { name: `Esgotado: ${product}` }).click()
    const response = await sent
    expect(response.status()).toBe(200)
    expect(response.request().headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
    await expect(row.getByRole('button', { name: `Esgotado: ${product}` })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // CA-03.05: chega ao outro aparelho em até 2 segundos, sem recarregar.
    await expect(staffToggle).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 })

    // A cozinha também libera de volta (RN-03.11), e o painel do dono acompanha.
    await staffToggle.click()
    await expect(row.getByRole('button', { name: `Esgotado: ${product}` })).toHaveAttribute(
      'aria-pressed',
      'false',
      { timeout: 2_000 },
    )
  } finally {
    await staffContext.close()
  }
})

test('colaborador vê só as estações liberadas, com nome e tipo (RN-03.16)', async ({ page }) => {
  // Só a Cozinha liberada: entra direto nela, sem "Painel" nem "Trocar de estação" (CA-01.17).
  await loginStaffByLink(page, 'bruno', /\/estacao\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cozinha')
  await expect(page.getByTestId('go-panel')).toHaveCount(0)
  await expect(page.getByTestId('switch-station')).toHaveCount(0)

  await loginStaffByLinkAfterLogout(page)
  // A ana opera caixa e entra no painel; em "Balcão e estações" vê as duas liberadas.
  await expect(page).toHaveURL(/\/painel$/)
  await page.goto('/estacoes')
  const ana = page.locator('button[aria-pressed]')
  await expect(ana).toHaveCount(2)
  await expect(ana.nth(0)).toContainText('Balcão')
  await expect(ana.nth(0)).toContainText('Balcão de pedidos')
  await expect(ana.nth(1)).toContainText('Balcão de entrega')
  await ana.nth(0).click()
  await expect(page).toHaveURL(/\/balcao$/)
  await page.getByRole('button', { name: 'Esgotados' }).click()
  await expect(page.getByRole('heading', { name: 'Esgotados' }).first()).toBeVisible()
})

async function loginStaffByLinkAfterLogout(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(/\/entrar$/)
  await loginStaffByLink(page, 'ana')
}

test('dono vê o acesso da equipe com código, link e QR', async ({ page }) => {
  await loginOwner(page)
  await page.goto('/painel/acesso-da-equipe')
  await expect(page.getByTestId('access-code')).toHaveText('ESPT26')
  await expect(page.getByTestId('access-link')).toHaveValue(/\/e\/ESPT26$/)
  const qr = page.getByTestId('access-qr')
  await expect(qr).toBeVisible()
  expect((await qr.boundingBox())!.width).toBeGreaterThanOrEqual(250)
})
