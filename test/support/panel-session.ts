import type { VueWrapper } from '@vue/test-utils'
import { vi } from 'vitest'
import { useNuxtApp } from '#app'
import { useSessionStore, type PanelMe } from '~/stores/session'
import { UNIT } from './operation-fixtures'

export const PERSON = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8e'

/** Sessão do painel: o dono, ou um colaborador que opera caixa (RN-01.23). */
export function signInAs(type: 'owner' | 'staff' = 'owner', canOperateCash = true): void {
  const session = useSessionStore()
  session.me = {
    subject: { type, id: PERSON, name: 'Pessoa', email: null, username: null },
    organization: {
      id: PERSON,
      name: 'Espetinho do Piloto',
      accessCode: 'ESPT26',
      subscriptionStatus: 'active',
      suspendedReason: null,
    },
    units: [
      {
        id: UNIT,
        name: 'Barraca da Praça',
        canOperateCash,
        allStations: type === 'owner',
        lateAfterMinutes: 15,
        stationIds: [],
        stations: [{ id: 'counter', name: 'Balcão', kind: 'counter' }],
      },
    ],
    session: { id: PERSON, deviceId: PERSON, accessTokenExpiresAt: '', expiresAt: '' },
    impersonation: null,
  } as unknown as PanelMe
  session.status = 'authenticated'
}

export function okResponse<T>(body: T, status = 200) {
  return {
    data: body,
    error: undefined,
    response: new Response(JSON.stringify(body), { status }),
  }
}

export function failResponse(status: number, code: string, message: string) {
  const body = { error: { code, message, details: {} } }
  return { data: undefined, error: body, response: new Response(JSON.stringify(body), { status }) }
}

type Handler = (init: unknown) => unknown

/** Rotas falsas do openapi-fetch (`GET`, `POST`…); as outras respondem lista vazia. */
export function mockApi(method: 'GET' | 'POST' | 'PUT' | 'PATCH', routes: Record<string, Handler>) {
  return vi.spyOn(useNuxtApp().$api, method).mockImplementation(((route: string, init: unknown) => {
    const handler = routes[route]
    return Promise.resolve(handler ? handler(init) : okResponse({ data: [], nextCursor: null }))
  }) as never)
}

/** Telas montadas, para desmontar no fim de cada teste. */
export const mountedWrappers: Pick<VueWrapper, 'unmount'>[] = []
export function unmountAll(): void {
  while (mountedWrappers.length) mountedWrappers.pop()!.unmount()
}
