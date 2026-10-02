import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test'

try {
  process.loadEnvFile('.env.local')
} catch {
  // Sem .env.local: usa os padrões.
}

/** Dados do seed da API (README do varal-web-api, seção Seed). */
export const seed = {
  ownerEmail: 'dono@varal.local',
  ownerName: 'Dono do Piloto',
  accessCode: 'ESPT26',
  organizationName: 'Espetinho do Piloto',
  staffUsername: 'ana',
  adminEmail: 'admin@varal.local',
  password: 'varal12345',
}

export const apiBaseUrl = (process.env.NUXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
)

export const mailpitUrl = (process.env.MAILPIT_URL ?? 'http://localhost:8025').replace(/\/+$/, '')

/** Confere que a API está de pé antes dos testes, com uma mensagem clara se não estiver. */
export async function expectApiUp(): Promise<void> {
  const context = await playwrightRequest.newContext()
  try {
    const response = await context.get(`${apiBaseUrl}/api/v1/health`)
    expect(response.ok(), `API fora do ar em ${apiBaseUrl}`).toBe(true)
  } catch (error) {
    throw new Error(
      `API não respondeu em ${apiBaseUrl}. Suba a API (pnpm dev no varal-web-api) antes do pnpm test:e2e.`,
      { cause: error },
    )
  } finally {
    await context.dispose()
  }
}

/**
 * Os cookies da sessão são `Secure` (`__Host-`/`__Secure-`, spec 01, seção 7.2). O
 * Chromium aceita `Secure` em http://localhost; o WebKit do Playwright no Linux não
 * guarda esses cookies em http. Em produção (https) o Safari funciona normalmente.
 * Testes que dependem da sessão rodam só nos projetos Chromium.
 */
export function skipWithoutSessionCookies(browserName: string): void {
  test.skip(
    browserName === 'webkit',
    'WebKit do Playwright não guarda cookies Secure em http://localhost (sessão só em https).',
  )
}

/**
 * A API limita logins a 20 por minuto por IP (RN-01.02), e a suíte inteira passa disso. Quando
 * a tela mostra "Muitas tentativas", espera e tenta de novo, em vez de falhar.
 */
async function submitLogin(page: Page, done: RegExp): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.getByRole('button', { name: 'Entrar' }).click()
    const limited = page.getByText('Muitas tentativas')
    const outcome = await Promise.race([
      page.waitForURL(done, { timeout: 10_000 }).then(() => 'ok' as const),
      limited.waitFor({ timeout: 10_000 }).then(() => 'limited' as const),
    ]).catch(() => 'timeout' as const)
    if (outcome === 'ok') return
    if (outcome === 'limited') await page.waitForTimeout(10_000)
    else break
  }
  await expect(page).toHaveURL(done)
}

export async function loginOwner(page: Page): Promise<void> {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(seed.ownerEmail)
  await page.getByLabel('Senha', { exact: true }).fill(seed.password)
  await submitLogin(page, /\/painel$/)
}

/**
 * Login do colaborador pelo link. Depois do login (RN-01.26): quem opera caixa vai ao painel
 * (`ana` no seed); quem tem uma única estação entra direto nela (`bruno`, Cozinha).
 */
export async function loginStaffByLink(
  page: Page,
  username = seed.staffUsername,
  done: RegExp = /\/(painel|estacoes|balcao|estacao\/[\w-]+)$/,
): Promise<void> {
  await page.goto(`/e/${seed.accessCode}`)
  await page.getByLabel('Usuário').fill(username)
  await page.getByLabel('Senha', { exact: true }).fill(seed.password)
  await submitLogin(page, done)
}

/**
 * Admin da plataforma (spec 02) pela API. Um login só por arquivo (a API limita logins por IP,
 * RN-01.02); para o "entrar como", os cookies do admin são copiados para o navegador, como
 * quando o admin abre o link pelo varal-admin-web no mesmo navegador (RN-02.21).
 */
export interface AdminSession {
  id: string
  name: string
  request: APIRequestContext
}

export async function loginAdmin(): Promise<AdminSession> {
  const request = await playwrightRequest.newContext()
  const login = await request.post(`${apiBaseUrl}/api/v1/admin/auth/login`, {
    headers: { 'X-Device-Id': crypto.randomUUID() },
    data: { email: seed.adminEmail, password: seed.password },
  })
  expect(login.status(), await login.text()).toBe(200)
  const me = await request.get(`${apiBaseUrl}/api/v1/admin/auth/me`)
  expect(me.status()).toBe(200)
  const body = (await me.json()) as { admin: { id: string; name: string } }
  return { id: body.admin.id, name: body.admin.name, request }
}

/** Põe a sessão do admin no navegador (cookies do admin no host da API). */
export async function shareAdminSession(admin: AdminSession, context: BrowserContext) {
  const { cookies } = await admin.request.storageState()
  await context.addCookies(cookies)
}

export async function adminCall<T = unknown>(
  admin: AdminSession,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await admin.request.fetch(`${apiBaseUrl}/api/v1/admin${path}`, {
    method,
    data: data as never,
  })
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true)
  return (response.status() === 204 ? undefined : await response.json()) as T
}

/** Organização do seed, com a situação atual da assinatura. */
export async function seedOrganization(
  admin: AdminSession,
): Promise<{ id: string; subscriptionStatus: string }> {
  const page = await adminCall<{
    data: { id: string; accessCode: string; subscriptionStatus: string }[]
  }>(admin, 'GET', `/organizations?search=${seed.accessCode}`)
  const organization = page.data.find((o) => o.accessCode === seed.accessCode)
  expect(organization, 'organização do seed não encontrada').toBeDefined()
  return organization!
}

/**
 * Operação pela API como o dono (spec 04), para preparar comandas e pedidos sem passar pela
 * tela. Um login por arquivo de teste.
 */
export interface OwnerApi {
  request: APIRequestContext
  unitId: string
  /** Primeiro caixa cadastrado da unidade ("Caixa 1" do seed). */
  cashRegisterId: string
  /** Garante o "Caixa 1" aberto (o seed já o deixa aberto); devolve a abertura em andamento. */
  ensureRegisterOpen: () => Promise<{ sessionId: string }>
  get: <T = unknown>(path: string) => Promise<T>
  post: <T = unknown>(path: string, data: unknown) => Promise<T>
  productId: (name: string) => string
  modifierId: (product: string, modifier: string) => string
  createTab: (customerName: string) => Promise<{ id: string; number: number }>
  createOrder: (
    tabId: string,
    items: { product: string; quantity: number; modifiers?: string[] }[],
  ) => Promise<{ id: string; items: { id: string; version: number; quantity: number }[] }>
  getTab: (tabId: string) => Promise<{
    orders: {
      items: { id: string; quantity: number; stageName: string; canceledAt: string | null }[]
    }[]
    totalCents: number
  }>
}

interface MenuForTests {
  categories: {
    products: {
      id: string
      name: string
      modifierGroups: { modifiers: { id: string; name: string }[] }[]
    }[]
  }[]
}

export async function ownerApi(): Promise<OwnerApi> {
  const request = await playwrightRequest.newContext({
    extraHTTPHeaders: { 'X-Device-Id': crypto.randomUUID() },
  })
  let login = await request.post(`${apiBaseUrl}/api/v1/auth/owner/login`, {
    data: { email: seed.ownerEmail, password: seed.password },
  })
  // Limite de logins por IP (RN-01.02): espera o tempo pedido pela API e tenta de novo.
  for (let attempt = 0; login.status() === 429 && attempt < 6; attempt += 1) {
    const body = (await login.json()) as { error: { details?: { retryAfterSeconds?: number } } }
    await new Promise((done) =>
      setTimeout(done, ((body.error.details?.retryAfterSeconds ?? 10) + 1) * 1000),
    )
    login = await request.post(`${apiBaseUrl}/api/v1/auth/owner/login`, {
      data: { email: seed.ownerEmail, password: seed.password },
    })
  }
  expect(login.status(), await login.text()).toBe(200)
  const me = (await (await request.get(`${apiBaseUrl}/api/v1/auth/me`)).json()) as {
    units: { id: string }[]
  }
  const unitId = me.units[0]!.id
  const registers = (await (
    await request.get(`${apiBaseUrl}/api/v1/units/${unitId}/cash-registers`)
  ).json()) as {
    data: { id: string; active: boolean; session: { id: string; status: string } | null }[]
  }
  const cashRegisterId = registers.data.find((register) => register.active)!.id
  const menu = (await (
    await request.get(`${apiBaseUrl}/api/v1/units/${unitId}/menu`)
  ).json()) as MenuForTests
  const products = menu.categories.flatMap((category) => category.products)
  const product = (name: string) => {
    const found = products.find((item) => item.name === name)
    expect(found, `produto ${name} do seed`).toBeDefined()
    return found!
  }
  const modifierId = (productName: string, modifier: string) =>
    product(productName)
      .modifierGroups.flatMap((group) => group.modifiers)
      .find((item) => item.name === modifier)!.id

  async function post<T>(path: string, data: unknown): Promise<T> {
    const response = await request.post(`${apiBaseUrl}/api/v1${path}`, {
      data: data as never,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    })
    expect(response.ok(), `POST ${path}: ${await response.text()}`).toBe(true)
    return (await response.json()) as T
  }

  async function get<T>(path: string): Promise<T> {
    const response = await request.get(`${apiBaseUrl}/api/v1${path}`)
    expect(response.ok(), `GET ${path}: ${await response.text()}`).toBe(true)
    return (await response.json()) as T
  }

  async function ensureRegisterOpen(): Promise<{ sessionId: string }> {
    const list = await get<{
      data: { id: string; session: { id: string; status: string } | null }[]
    }>(`/units/${unitId}/cash-registers`)
    const register = list.data.find((item) => item.id === cashRegisterId)!
    if (register.session?.status === 'open') return { sessionId: register.session.id }
    const opened = await post<{ session: { id: string } }>(
      `/cash-registers/${cashRegisterId}/open`,
      {
        openingFloatCents: 10000,
      },
    )
    return { sessionId: opened.session.id }
  }

  return {
    request,
    unitId,
    cashRegisterId,
    ensureRegisterOpen,
    get,
    post,
    productId: (name) => product(name).id,
    modifierId,
    createTab: (customerName) => post(`/units/${unitId}/tabs`, { customerName }),
    createOrder: (tabId, items) =>
      post(`/tabs/${tabId}/orders`, {
        items: items.map((item) => ({
          productId: product(item.product).id,
          quantity: item.quantity,
          modifierIds: (item.modifiers ?? []).map((name) => modifierId(item.product, name)),
        })),
      }),
    getTab: async (tabId) =>
      (await (await request.get(`${apiBaseUrl}/api/v1/tabs/${tabId}`)).json()) as never,
  }
}

/** Sufixo para os nomes criados: a suíte roda de novo no mesmo banco. */
export function runSuffix(): string {
  return Date.now().toString(36).slice(-5)
}

/**
 * No `pnpm dev`, o botão flutuante do Nuxt DevTools fica no meio do rodapé, por cima da ação
 * principal fixa das telas de operação (spec 08, seção 7). Ele não existe no build; nos testes,
 * fica escondido.
 */
export async function hideDevtools(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = '[id^="nuxt-devtools"], .nuxt-devtools-panel { display: none !important; }'
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
  })
}
