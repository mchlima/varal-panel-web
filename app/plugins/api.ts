import createClient from 'openapi-fetch'
import type { paths } from '~/api/schema'

/**
 * Cliente HTTP da API, tipado pelo openapi.json do varal-web-api (RN-01.11).
 * A sessão vai em cookies emitidos pela API, por isso `credentials: 'include'`.
 * Uso: `const { $api } = useNuxtApp(); await $api.GET('/api/v1/...')`.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const api = createClient<paths>({
    baseUrl: config.public.apiBaseUrl,
    credentials: 'include',
  })

  return { provide: { api } }
})
