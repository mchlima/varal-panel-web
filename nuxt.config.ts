import tailwindcss from '@tailwindcss/vite'

// Variáveis do worktree (RN-01.07): o .env.local define PORT_OFFSET, PORT e
// NUXT_PUBLIC_API_BASE_URL. Valores já presentes no ambiente têm prioridade.
try {
  process.loadEnvFile('.env.local')
} catch {
  // Sem .env.local (CI ou checkout novo): usa os padrões abaixo.
}

// RN-01.08: o painel roda na porta 3100 + PORT_OFFSET.
const portOffset = Number(process.env.PORT_OFFSET ?? 0)
const devPort = Number(process.env.PORT ?? 3100 + portOffset)

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/test-utils/module'],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR' },
      title: 'Varal',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#BE185D' },
        { name: 'description', content: 'Varal: pedidos do balcão direto na cozinha.' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },
  runtimeConfig: {
    public: {
      // Fixado no build (app estático): cada ambiente tem o próprio build.
      // Sobrescrito por NUXT_PUBLIC_API_BASE_URL.
      apiBaseUrl: 'http://localhost:3000',
    },
  },
  devServer: {
    port: devPort,
  },
  typescript: {
    strict: true,
    typeCheck: false,
  },
  vite: {
    plugins: [tailwindcss()],
  },
})
