import createClient, { type Client } from 'openapi-fetch'
import type { paths } from '~/api/schema'
import { createSessionManager, type SessionManager } from '~/lib/session'

/**
 * Cliente HTTP da API, tipado pelo openapi.json do varal-web-api (RN-01.11).
 * A sessão vai em cookies emitidos pela API, por isso `credentials: 'include'`.
 * O middleware põe o `X-Device-Id` em toda requisição e, num 401, renova a sessão uma
 * única vez (compartilhada entre requisições simultâneas) e repete a requisição.
 *
 * Uso: `const { $api } = useNuxtApp(); await $api.GET('/api/v1/auth/me')`.
 */
export default defineNuxtPlugin({
  name: 'varal:api',
  dependsOn: ['varal:device'],
  setup(nuxtApp): {
    provide: { api: Client<paths>; apiBaseUrl: string; sessionManager: SessionManager }
  } {
    const config = useRuntimeConfig()
    const baseUrl = config.public.apiBaseUrl.replace(/\/+$/, '')
    const deviceId = nuxtApp.$deviceId as string

    const session = createSessionManager({
      baseUrl,
      getDeviceId: () => deviceId,
      onSessionLost: () => {
        void nuxtApp.runWithContext(() => useSessionStore().handleSessionLost())
      },
    })

    const api = createClient<paths>({ baseUrl, credentials: 'include' })
    api.use(session.middleware)

    return { provide: { api, apiBaseUrl: baseUrl, sessionManager: session } }
  },
})
