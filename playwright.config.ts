import { defineConfig, devices } from '@playwright/test'

/**
 * Testes de ponta a ponta (plano, seção 4): Android e iPhone emulados, contra a API real.
 *
 * Precisa da API rodando (com o seed) na URL de `NUXT_PUBLIC_API_BASE_URL` do
 * `.env.local`, com a porta do painel em `CORS_ORIGINS`. O painel sobe sozinho
 * (`pnpm dev`) se ainda não estiver rodando. Ver README, seção "Testes de ponta a ponta".
 */
try {
  process.loadEnvFile('.env.local')
} catch {
  // Sem .env.local: usa os padrões.
}

const port = Number(process.env.PORT ?? 3100 + Number(process.env.PORT_OFFSET ?? 0))
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // Folga para a espera do limite de logins por IP (RN-01.02) quando a suíte roda inteira.
  timeout: 120_000,
  use: {
    baseURL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
})
