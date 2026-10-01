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
 * Fiado (spec 06) contra a API real, com o seed (turno aberto na Barraca da Praça e um caixa
 * aberto). A quitação em outro turno usa uma unidade nova, com cardápio, turnos e caixas
 * próprios, desativada no fim para não mexer no turno do seed.
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

async function call<T = never>(method: 'GET' | 'POST' | 'PATCH', path: string, data?: unknown) {
  const response = await api.request.fetch(`${apiBaseUrl}/api/v1${path}`, {
    method,
    data: data as never,
    headers: method === 'GET' ? {} : { 'Idempotency-Key': crypto.randomUUID() },
  })
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true)
  return (await response.json()) as T
}

async function typeAmount(page: Page, digits: string) {
  for (const digit of digits) await page.getByTestId(`key-${digit}`).click()
}

async function chooseRegisterIfAsked(page: Page) {
  const option = page.getByTestId('register-option').first()
  if (await option.isVisible().catch(() => false)) await option.click()
}

/** Primeiro caixa aberto do turno (o seed pode ter sobras de outras execuções). */
async function openRegisterOf(shiftId: string): Promise<string> {
  const list = await call<{ data: { id: string; status: string }[] }>(
    'GET',
    `/shifts/${shiftId}/cash-registers`,
  )
  const open = list.data.find((register) => register.status === 'open')
  expect(open, 'o turno precisa de um caixa aberto').toBeDefined()
  return open!.id
}

/** Comanda em `closing` no turno do seed com `quantity` mandiocas (R$ 15,00 cada). */
async function closingTab(customerName: string, quantity: number) {
  const tab = await api.createTab(customerName)
  await api.createOrder(tab.id, [{ product: 'Mandioca frita', quantity }])
  await call('POST', `/tabs/${tab.id}/request-bill`, {})
  return tab
}

test('pendura com cliente novo só com nome, em cliente existente e avisa do homônimo (CA-06.01, CA-06.06, RN-06.02)', async ({
  browser,
  baseURL,
}) => {
  const suffix = runSuffix()
  const name = `Fiado ${suffix}`
  // CA-06.01: R$ 120,00 com R$ 20,00 já pagos fica com R$ 100,00 no fiado.
  const first = await closingTab(`Mesa ${suffix}`, 8)
  await call('POST', `/tabs/${first.id}/payments`, {
    method: 'pix',
    amountCents: 2_000,
    cashRegisterId: await openRegisterOf(api.shiftId),
  })

  const counter = await device(browser, baseURL)
  try {
    const page = counter.page
    await loginStaffByLink(page, 'ana')
    await page.getByRole('button', { name: /^Balcão Balcão de pedidos/ }).click()
    await expect(page.getByTestId('realtime-status')).toContainText('Conectado')

    await page.goto(`/balcao/comandas/${first.number}/receber`)
    await expect(page.getByTestId('receive-balance')).toHaveText('R$ 100,00')
    await page.getByTestId('hang-on-credit').click()
    const dialog = page.getByTestId('credit-dialog')
    await dialog.getByTestId('customer-new').click()
    await dialog.getByLabel('Nome').fill(name)
    await dialog.getByTestId('customer-submit').click()
    await expect(dialog.getByTestId('credit-amount')).toHaveText('R$ 100,00')
    await expect(dialog.getByTestId('credit-confirm')).toContainText(name)
    const hung = page.waitForResponse(
      (r) => r.url().endsWith(`/tabs/${first.id}/put-on-credit`) && r.request().method() === 'POST',
    )
    await dialog.getByTestId('credit-submit').click()
    const response = await hung
    expect(response.ok()).toBe(true)
    expect(response.request().headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
    await expect(page.getByTestId('tab-on-credit')).toContainText('R$ 100,00')
    await expect(page.getByTestId('receive-customer')).toContainText(name)

    // Aba Fiado do varal: cliente e saldo.
    await page.goto('/balcao?aba=fiado')
    const card = page.getByTestId('credit-tab-card').filter({ hasText: name })
    await expect(card.getByTestId('credit-tab-balance')).toHaveText('R$ 100,00')

    // Cliente existente, achado pela busca.
    const second = await closingTab(`Mesa ${suffix} B`, 2)
    await page.goto(`/balcao/comandas/${second.number}/receber`)
    await page.getByTestId('hang-on-credit').click()
    await dialog.getByTestId('customer-search').fill(name)
    await dialog.getByTestId('customer-result').filter({ hasText: name }).click()
    await expect(dialog.getByTestId('credit-amount')).toHaveText('R$ 30,00')
    await dialog.getByTestId('credit-submit').click()
    await expect(page.getByTestId('tab-on-credit')).toContainText('R$ 30,00')

    // Homônimo sem identificação: avisa e sugere a referência (RN-06.02).
    const third = await closingTab(`Mesa ${suffix} C`, 1)
    await page.goto(`/balcao/comandas/${third.number}/receber`)
    await page.getByTestId('hang-on-credit').click()
    await dialog.getByTestId('customer-new').click()
    await dialog.getByLabel('Nome').fill(name)
    await dialog.getByTestId('customer-submit').click()
    await expect(dialog.getByTestId('homonym-warning')).toContainText('Preencha a referência')
    await dialog.getByRole('button', { name: 'Preencher referência' }).click()
    await dialog.getByLabel('Referência (opcional)').fill('apto 42')
    await dialog.getByTestId('customer-submit').click()
    await expect(dialog.getByTestId('credit-confirm')).toContainText(`${name} (apto 42)`)
    await dialog.getByTestId('credit-submit').click()
    await expect(page.getByTestId('tab-on-credit')).toBeVisible()

    // A busca mostra os dois com os dados de identificação (CA-06.06).
    const found = await call<{ data: { name: string; reference: string | null }[] }>(
      'GET',
      `/units/${api.unitId}/customers?q=${encodeURIComponent(name)}`,
    )
    expect(found.data.map((c) => c.reference).sort()).toEqual(['apto 42', null].sort())
  } finally {
    await counter.context.close()
  }
})

test('quita em partes em outro turno e o caixa mostra a quitação separada (CA-06.03, RN-05.22)', async ({
  page,
}) => {
  const suffix = runSuffix()
  const unit = await call<{ id: string }>('POST', '/units', {
    name: `Fiado ${suffix}`,
    lateAfterMinutes: 15,
  })
  try {
    const category = await call<{ id: string }>('POST', '/categories', {
      unitId: unit.id,
      name: 'Espetos',
    })
    const product = await call<{ id: string }>('POST', '/products', {
      categoryId: category.id,
      name: 'Espeto de picanha',
      priceCents: 10_000,
    })
    // Turno A: comanda de R$ 100,00 pendurada no cliente, itens entregues, caixa e turno fechados.
    const shiftA = await call<{ id: string }>('POST', `/units/${unit.id}/shifts`, {
      type: 'direct_sale',
    })
    const registerA = await call<{ id: string }>('POST', `/shifts/${shiftA.id}/cash-registers`, {
      openingFloatCents: 0,
    })
    const customer = await call<{ id: string }>('POST', `/units/${unit.id}/customers`, {
      name: `Cliente ${suffix}`,
      phone: '(11) 98765-4321',
    })
    const tab = await call<{ id: string; number: number }>('POST', `/shifts/${shiftA.id}/tabs`, {
      customerName: 'Mesa 1',
    })
    await call('POST', `/tabs/${tab.id}/orders`, {
      items: [{ productId: product.id, quantity: 1, modifierIds: [] }],
    })
    for (let round = 0; round < 6; round += 1) {
      const current = await api.getTab(tab.id)
      const items = current.orders.flatMap((order) => order.items) as unknown as {
        id: string
        version: number
      }[]
      let moved = false
      for (const item of items) {
        const response = await api.request.post(
          `${apiBaseUrl}/api/v1/order-items/${item.id}/advance`,
          {
            data: { version: item.version },
            headers: { 'Idempotency-Key': crypto.randomUUID() },
          },
        )
        moved ||= response.ok()
      }
      if (!moved) break
    }
    await call('POST', `/tabs/${tab.id}/request-bill`, {})
    await call('POST', `/tabs/${tab.id}/put-on-credit`, { customerId: customer.id })
    const closingA = await call<{
      version: number
      expected: { method: string; expectedCents: number }[]
    }>('GET', `/cash-registers/${registerA.id}`)
    await call('POST', `/cash-registers/${registerA.id}/close`, {
      counts: closingA.expected.map((e) => ({ method: e.method, informedCents: e.expectedCents })),
      version: closingA.version,
    })
    await call('POST', `/shifts/${shiftA.id}/close`)

    // Turno B com um caixa: a quitação entra nele.
    const shiftB = await call<{ id: string }>('POST', `/units/${unit.id}/shifts`, {
      type: 'direct_sale',
    })
    const registerB = await call<{ id: string }>('POST', `/shifts/${shiftB.id}/cash-registers`, {
      name: `Caixa B ${suffix}`,
      openingFloatCents: 0,
    })

    await page.setViewportSize({ width: 1024, height: 900 })
    await hideDevtools(page.context())
    await loginOwner(page)
    await page.goto(`/painel/fiado?unidade=${unit.id}`)
    await expect(page.getByTestId('receivable-total')).toHaveText('R$ 100,00')
    await page
      .getByTestId('receivable-customer')
      .filter({ hasText: `Cliente ${suffix}` })
      .click()
    await expect(page.getByTestId('customer-balance')).toHaveText('R$ 100,00')
    await page.getByTestId('settle-tab').click()
    await expect(page).toHaveURL(new RegExp(`/balcao/comandas/${tab.number}/receber\\?comanda=`))
    await expect(page.getByTestId('receive-balance')).toHaveText('R$ 100,00')
    await chooseRegisterIfAsked(page)

    // Parcial: R$ 60,00 deixa R$ 40,00 e a comanda continua no fiado.
    await page.getByTestId('method-pix').click()
    await typeAmount(page, '6000')
    await page.getByTestId('confirm-payment').click()
    await expect(page.getByTestId('receive-balance')).toHaveText('R$ 40,00')
    await expect(page.getByTestId('tab-on-credit')).toContainText('R$ 40,00')
    // Total: R$ 40,00 quita.
    await page.getByTestId('method-pix').click()
    await page.getByTestId('confirm-payment').click()
    await expect(page.getByTestId('tab-settled')).toBeVisible()

    const settled = (await api.getTab(tab.id)) as unknown as {
      status: string
      payments: { amountCents: number; shiftId: string; isCreditSettlement: boolean }[]
    }
    expect(settled.status).toBe('settled')
    expect(
      settled.payments.map((p) => [p.amountCents, p.shiftId === shiftB.id, p.isCreditSettlement]),
    ).toEqual([
      [6_000, true, true],
      [4_000, true, true],
    ])

    // Caixa do turno B: vendas e quitações separadas (RN-05.22).
    await page.goto(`/caixas?unidade=${unit.id}`)
    const card = page.getByTestId('register-card').filter({ hasText: `Caixa B ${suffix}` })
    await expect(card.getByTestId('split-pix')).toContainText(
      'vendas R$ 0,00 · quitações de fiado R$ 100,00',
    )
    await expect(card.getByTestId('register-credit-settlements')).toContainText('R$ 100,00')
    await card.getByTestId('close-register-link').click()
    await expect(page.getByTestId('count-split-pix')).toContainText('quitações de fiado R$ 100,00')

    // Histórico de quitações no cliente.
    await page.goto(`/painel/fiado/${customer.id}`)
    await expect(page.getByTestId('customer-balance')).toHaveText('R$ 0,00')
    await expect(page.getByTestId('settlement-row')).toHaveCount(2)

    const closingB = await call<{
      version: number
      expected: { method: string; expectedCents: number }[]
    }>('GET', `/cash-registers/${registerB.id}`)
    await call('POST', `/cash-registers/${registerB.id}/close`, {
      counts: closingB.expected.map((e) => ({ method: e.method, informedCents: e.expectedCents })),
      version: closingB.version,
    })
    await call('POST', `/shifts/${shiftB.id}/close`)
  } finally {
    await api.request.patch(`${apiBaseUrl}/api/v1/units/${unit.id}`, { data: { active: false } })
  }
})

test('remover cliente com fiado é recusado e explicado; sem fiado, anonimiza (CA-06.05, RN-06.03)', async ({
  page,
}) => {
  const suffix = runSuffix()
  const owing = await call<{ id: string }>('POST', `/units/${api.unitId}/customers`, {
    name: `Devedor ${suffix}`,
  })
  const tab = await closingTab(`Mesa ${suffix}`, 1)
  await call('POST', `/tabs/${tab.id}/put-on-credit`, { customerId: owing.id })
  const free = await call<{ id: string }>('POST', `/units/${api.unitId}/customers`, {
    name: `Sem dívida ${suffix}`,
    reference: 'barraca do lado',
  })

  await hideDevtools(page.context())
  await loginOwner(page)
  await page.goto(`/painel/fiado/${owing.id}`)
  await expect(page.getByTestId('customer-balance')).toHaveText('R$ 15,00')
  await page.getByRole('button', { name: 'Remover cliente' }).click()
  await page
    .getByRole('group', { name: /Remover Devedor/ })
    .getByRole('button', { name: 'Remover' })
    .click()
  await expect(page.getByTestId('remove-blocked')).toContainText(
    'ainda tem fiado a receber (R$ 15,00)',
  )
  await expect(page.getByTestId('customer-name')).toHaveText(`Devedor ${suffix}`)

  await page.goto(`/painel/fiado/${free.id}`)
  await page.getByRole('button', { name: 'Remover cliente' }).click()
  await page
    .getByRole('group', { name: /Remover Sem dívida/ })
    .getByRole('button', { name: 'Remover' })
    .click()
  await expect(page.getByTestId('customer-name')).toHaveText('Cliente removido')
  await expect(page.getByText('Removido a pedido')).toBeVisible()
})

test('pendurar sem conexão fica "Na fila" e vai quando a rede volta, sem duplicar (spec 01, seção 11)', async ({
  browser,
  baseURL,
}) => {
  const suffix = runSuffix()
  const customer = await call<{ id: string }>('POST', `/units/${api.unitId}/customers`, {
    name: `Offline ${suffix}`,
  })
  const tab = await closingTab(`Mesa ${suffix}`, 2)
  const counter = await device(browser, baseURL)
  try {
    const { page, context } = counter
    await loginStaffByLink(page, 'ana')
    await page.getByRole('button', { name: /^Balcão Balcão de pedidos/ }).click()
    await page.goto(`/balcao/comandas/${tab.number}/receber`)
    await expect(page.getByTestId('receive-balance')).toHaveText('R$ 30,00')
    await page.getByTestId('hang-on-credit').click()
    const dialog = page.getByTestId('credit-dialog')
    await dialog.getByTestId('customer-search').fill(`Offline ${suffix}`)
    await dialog.getByTestId('customer-result').first().click()

    await context.setOffline(true)
    await expect(page.getByTestId('connection-banner')).toContainText('Sem conexão')
    await dialog.getByTestId('credit-submit').click()
    await expect(page.getByTestId('pending-credit')).toContainText(
      `Pendurar em Offline ${suffix}: Na fila`,
    )
    // Estado honesto: a comanda continua "Fechando" até a API confirmar.
    await expect(page.getByTestId('tab-on-credit')).toHaveCount(0)

    await context.setOffline(false)
    await expect(page.getByTestId('tab-on-credit')).toContainText('R$ 30,00')
    await expect(page.getByTestId('pending-credit')).toHaveCount(0)
    const detail = await call<{ tabs: { id: string }[]; balanceCents: number }>(
      'GET',
      `/customers/${customer.id}`,
    )
    expect(detail.tabs.map((t) => t.id)).toEqual([tab.id])
    expect(detail.balanceCents).toBe(3_000)
  } finally {
    await counter.context.close()
  }
})
