import type { Middleware } from 'openapi-fetch'

export const REFRESH_PATH = '/api/v1/auth/refresh'

/**
 * Rotas que não passam pela renovação automática: a própria renovação (senão entraria
 * em loop) e as rotas abertas, em que um 401 é resposta de negócio (credenciais erradas).
 */
const NO_REFRESH_PATHS = [
  REFRESH_PATH,
  '/api/v1/auth/logout',
  '/api/v1/auth/owner/login',
  '/api/v1/auth/staff/login',
  '/api/v1/auth/password/forgot',
  '/api/v1/auth/password/reset',
  '/api/v1/auth/access-code/',
]

export type RefreshResult = 'renewed' | 'rejected' | 'network-error'

export interface SessionManagerOptions {
  baseUrl: string
  getDeviceId: () => string
  /** Chamado quando a renovação é recusada: a sessão acabou e o app volta ao login. */
  onSessionLost: () => void
  fetch?: typeof globalThis.fetch
}

export interface SessionManager {
  /** Middleware do openapi-fetch: `X-Device-Id` em tudo e renovação em 401. */
  middleware: Middleware
  /**
   * Renova a sessão (`POST /auth/refresh`). Chamadas simultâneas dividem a mesma
   * renovação, para o token rotativo não ser apresentado duas vezes.
   */
  refresh: () => Promise<RefreshResult>
  /** `fetch` com as mesmas regras do middleware, para a fila offline. */
  fetch: (request: Request) => Promise<Response>
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function canRefresh(request: Request): boolean {
  const path = pathOf(request.url)
  return !NO_REFRESH_PATHS.some((prefix) => path === prefix || path.startsWith(prefix))
}

export function createSessionManager(options: SessionManagerOptions): SessionManager {
  const doFetch = (input: Request) => (options.fetch ?? globalThis.fetch)(input)
  let inflight: Promise<RefreshResult> | null = null

  function refresh(): Promise<RefreshResult> {
    inflight ??= (async (): Promise<RefreshResult> => {
      try {
        const response = await doFetch(
          new Request(`${options.baseUrl}${REFRESH_PATH}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-Device-Id': options.getDeviceId() },
          }),
        )
        if (response.ok) return 'renewed'
        // 5xx: a sessão pode continuar válida; não desloga por instabilidade do servidor.
        if (response.status >= 500) return 'network-error'
        options.onSessionLost()
        return 'rejected'
      } catch {
        // Sem rede: mantém a sessão; a próxima tentativa renova.
        return 'network-error'
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  function withDevice(request: Request): Request {
    request.headers.set('X-Device-Id', options.getDeviceId())
    return request
  }

  /** Repete a requisição uma única vez depois de renovar; sem novo 401 → renovação. */
  async function retryAfterRefresh(original: Request, response: Response): Promise<Response> {
    const result = await refresh()
    if (result !== 'renewed') return response
    return doFetch(original)
  }

  const retries = new Map<string, Request>()

  const middleware: Middleware = {
    onRequest({ request, id }) {
      withDevice(request)
      if (canRefresh(request)) retries.set(id, request.clone())
      return request
    },
    async onResponse({ response, id }) {
      const original = retries.get(id)
      retries.delete(id)
      if (response.status !== 401 || !original) return undefined
      return retryAfterRefresh(original, response)
    },
    onError({ id }) {
      retries.delete(id)
    },
  }

  async function sessionFetch(request: Request): Promise<Response> {
    withDevice(request)
    const retry = canRefresh(request) ? request.clone() : null
    const response = await doFetch(request)
    if (response.status !== 401 || !retry) return response
    return retryAfterRefresh(retry, response)
  }

  return { middleware, refresh, fetch: sessionFetch }
}
