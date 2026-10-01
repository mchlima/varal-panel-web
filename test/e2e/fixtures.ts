import { expect, request as playwrightRequest, test, type Page } from '@playwright/test'

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

export async function loginStaffByLink(page: Page): Promise<void> {
  await page.goto(`/e/${seed.accessCode}`)
  await page.getByLabel('Usuário').fill(seed.staffUsername)
  await page.getByLabel('Senha', { exact: true }).fill(seed.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/estacoes$/)
}
