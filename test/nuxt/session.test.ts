import createClient from 'openapi-fetch'
import { describe, expect, it, vi } from 'vitest'
import type { paths } from '~/api/schema'
import { createSessionManager } from '~/lib/session'

const BASE = 'http://api.test'
const DEVICE = '0192f000-0000-7000-8000-000000000001'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const me = {
  subject: { type: 'owner', id: DEVICE, name: 'Dono', email: 'd@v.l', username: null },
  organization: {
    id: DEVICE,
    name: 'Org',
    accessCode: 'ESPT26',
    subscriptionStatus: 'pilot',
    suspendedReason: null,
  },
  units: [],
  session: { id: DEVICE, deviceId: DEVICE, accessTokenExpiresAt: '', expiresAt: '' },
  impersonation: null,
}

/** API falsa: o token de acesso vence até a primeira renovação. */
function fakeApi(options: { refreshStatus?: number; refreshDelay?: number } = {}) {
  let renewed = false
  const calls: { method: string; path: string; device: string | null; body: string }[] = []
  const fetch = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname
    calls.push({
      method: request.method,
      path,
      device: request.headers.get('X-Device-Id'),
      body: request.method === 'GET' ? '' : await request.clone().text(),
    })
    if (path === '/api/v1/auth/refresh') {
      await new Promise((r) => setTimeout(r, options.refreshDelay ?? 5))
      const status = options.refreshStatus ?? 200
      if (status === 200) renewed = true
      return json(
        status,
        status === 200 ? {} : { error: { code: 'UNAUTHENTICATED', message: 'x', details: {} } },
      )
    }
    if (path === '/api/v1/auth/owner/login') {
      return json(401, {
        error: { code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos.', details: {} },
      })
    }
    if (!renewed) {
      return json(401, {
        error: { code: 'UNAUTHENTICATED', message: 'Sessão expirada.', details: {} },
      })
    }
    return path === '/api/v1/auth/password/change' ? json(200, me.session) : json(200, me)
  })
  return { fetch, calls }
}

function setup(options: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(options)
  const onSessionLost = vi.fn()
  const manager = createSessionManager({
    baseUrl: BASE,
    getDeviceId: () => DEVICE,
    onSessionLost,
    fetch: api.fetch as unknown as typeof fetch,
  })
  const client = createClient<paths>({
    baseUrl: BASE,
    credentials: 'include',
    fetch: api.fetch as unknown as typeof fetch,
  })
  client.use(manager.middleware)
  return { ...api, manager, client, onSessionLost }
}

describe('sessão: X-Device-Id e renovação em 401 (spec 01, seção 7.2; plano 2.2)', () => {
  it('manda o X-Device-Id em toda requisição, inclusive na renovação', async () => {
    const { client, calls } = setup()
    await client.GET('/api/v1/auth/me')
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c.device === DEVICE)).toBe(true)
  })

  it('num 401, renova e repete a requisição original uma vez', async () => {
    const { client, calls } = setup()
    const { data } = await client.GET('/api/v1/auth/me')
    expect(data?.organization.name).toBe('Org')
    expect(calls.map((c) => c.path)).toEqual([
      '/api/v1/auth/me',
      '/api/v1/auth/refresh',
      '/api/v1/auth/me',
    ])
  })

  it('repete com o mesmo corpo depois de renovar', async () => {
    const { client, calls } = setup()
    await client.POST('/api/v1/auth/password/change', {
      body: { currentPassword: 'antiga123', newPassword: 'nova12345' },
    })
    const changes = calls.filter((c) => c.path === '/api/v1/auth/password/change')
    expect(changes).toHaveLength(2)
    expect(JSON.parse(changes[1]!.body)).toEqual({
      currentPassword: 'antiga123',
      newPassword: 'nova12345',
    })
  })

  it('requisições simultâneas com 401 dividem uma única renovação', async () => {
    const { client, calls } = setup({ refreshDelay: 30 })
    const results = await Promise.all([
      client.GET('/api/v1/auth/me'),
      client.GET('/api/v1/auth/me'),
      client.GET('/api/v1/auth/me'),
    ])
    expect(results.every((r) => r.data)).toBe(true)
    expect(calls.filter((c) => c.path === '/api/v1/auth/refresh')).toHaveLength(1)
  })

  it('renovação recusada encerra a sessão e devolve o 401', async () => {
    const { client, onSessionLost, calls } = setup({ refreshStatus: 401 })
    const { error, response } = await client.GET('/api/v1/auth/me')
    expect(response.status).toBe(401)
    expect(error?.error.code).toBe('UNAUTHENTICATED')
    expect(onSessionLost).toHaveBeenCalledOnce()
    expect(calls.filter((c) => c.path === '/api/v1/auth/refresh')).toHaveLength(1)
  })

  it('falha de rede na renovação não desloga', async () => {
    const { manager, onSessionLost, fetch } = setup()
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(manager.refresh()).resolves.toBe('network-error')
    expect(onSessionLost).not.toHaveBeenCalled()
  })

  it('401 do login é resposta de negócio: não tenta renovar', async () => {
    const { client, calls, onSessionLost } = setup()
    const { error } = await client.POST('/api/v1/auth/owner/login', {
      params: { header: { 'X-Device-Id': DEVICE } },
      body: { email: 'dono@varal.local', password: 'errada' },
    })
    expect(error?.error.message).toBe('E-mail ou senha inválidos.')
    expect(calls.map((c) => c.path)).toEqual(['/api/v1/auth/owner/login'])
    expect(onSessionLost).not.toHaveBeenCalled()
  })

  it('o fetch da fila segue as mesmas regras', async () => {
    const { manager, calls } = setup()
    const response = await manager.fetch(
      new Request(`${BASE}/api/v1/auth/me`, { credentials: 'include' }),
    )
    expect(response.status).toBe(200)
    expect(calls.map((c) => c.path)).toEqual([
      '/api/v1/auth/me',
      '/api/v1/auth/refresh',
      '/api/v1/auth/me',
    ])
  })
})
