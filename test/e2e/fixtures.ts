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

export async function loginOwner(page: Page): Promise<void> {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(seed.ownerEmail)
  await page.getByLabel('Senha', { exact: true }).fill(seed.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/painel$/)
}

export async function loginStaffByLink(page: Page, username = seed.staffUsername): Promise<void> {
  await page.goto(`/e/${seed.accessCode}`)
  await page.getByLabel('Usuário').fill(username)
  await page.getByLabel('Senha', { exact: true }).fill(seed.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/estacoes$/)
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
