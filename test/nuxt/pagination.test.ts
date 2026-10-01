import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { components } from '~/api/schema'
import { PAGE_SIZE, useCursorList, type CursorPage } from '~/composables/useCursorList'
import SupportAccessPage from '~/pages/painel/acessos-de-suporte.vue'
import StaffPage from '~/pages/painel/colaboradores.vue'
import UnitsPage from '~/pages/painel/unidades/index.vue'
import type { PanelMe } from '~/stores/session'

type SupportAccess = components['schemas']['SupportAccess']
type StaffMember = components['schemas']['StaffMember']
type Unit = components['schemas']['Unit']

const ID = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8e'

function signIn() {
  const session = useSessionStore()
  session.me = {
    subject: { type: 'owner', id: ID, name: 'Dono', email: 'd@v.l', username: null },
    organization: {
      id: ID,
      name: 'Espetinho do Piloto',
      accessCode: 'ESPT26',
      subscriptionStatus: 'active',
      suspendedReason: null,
    },
    units: [],
    session: { id: ID, deviceId: ID, accessTokenExpiresAt: '', expiresAt: '' },
    impersonation: null,
  } satisfies PanelMe
  session.status = 'authenticated'
}

function ok<T>(body: T) {
  return { data: body, error: undefined, response: new Response(JSON.stringify(body)) }
}

function access(n: number): SupportAccess {
  return {
    id: `access-${n}`,
    adminName: `Admin ${n}`,
    reason: `Motivo ${n}`,
    active: false,
    startedAt: '2026-10-01T12:00:00Z',
    endedAt: '2026-10-01T12:30:00Z',
    endedBy: 'admin',
  }
}

function member(n: number): StaffMember {
  return {
    id: `staff-${n}`,
    name: `Pessoa ${n}`,
    username: `pessoa${n}`,
    email: null,
    active: true,
    hasPassword: true,
    permissions: [],
  }
}

function unit(n: number): Unit {
  return {
    id: `unit-${n}`,
    name: `Unidade ${n}`,
    active: true,
    lateAfterMinutes: 15,
    version: 1,
    menuVersion: 1,
    createdAt: '2026-10-01T12:00:00Z',
  }
}

/**
 * `GET` falso: a lista paginada responde em duas páginas (cursor `p2`); as outras rotas do
 * painel (comunicados etc.) respondem vazio.
 */
function mockPages<T>(path: string, first: T[], second: T[]) {
  return vi.spyOn(useNuxtApp().$api, 'GET').mockImplementation(((
    route: string,
    init?: { params?: { query?: { cursor?: string } } },
  ) => {
    if (route !== path) return Promise.resolve(ok({ data: [], nextCursor: null }))
    const cursor = init?.params?.query?.cursor
    return Promise.resolve(
      ok(cursor === 'p2' ? { data: second, nextCursor: null } : { data: first, nextCursor: 'p2' }),
    )
  }) as never)
}

function calls(spy: ReturnType<typeof mockPages>, path: string) {
  // O GET do openapi-fetch é sobrecarregado por rota; aqui só interessam rota e parâmetros.
  const all = spy.mock.calls as unknown as [string, unknown][]
  return all.filter(([route]) => route === path).map(([, init]) => init)
}

afterEach(() => {
  vi.restoreAllMocks()
  useSessionStore().clear()
})

describe('listas do painel com "Carregar mais" (limit e cursor)', () => {
  it.each([
    {
      name: 'acessos de suporte',
      page: SupportAccessPage,
      path: '/api/v1/support-access',
      first: [access(1), access(2)],
      second: [access(3)],
      label: 'Admin',
    },
    {
      name: 'colaboradores',
      page: StaffPage,
      path: '/api/v1/staff',
      first: [member(1), member(2)],
      second: [member(3)],
      label: 'Pessoa',
    },
    {
      name: 'unidades',
      page: UnitsPage,
      path: '/api/v1/units',
      first: [unit(1), unit(2)],
      second: [unit(3)],
      label: 'Unidade',
    },
  ])('$name: pede a primeira página e junta a seguinte ao fim', async (list) => {
    signIn()
    const get = mockPages<unknown>(list.path, list.first, list.second)
    const wrapper = await mountSuspended(list.page)
    await flushPromises()

    expect(calls(get, list.path)).toEqual([{ params: { query: { limit: PAGE_SIZE } } }])
    expect(wrapper.text()).not.toContain('Mostrando')
    const more = wrapper.findAll('button').find((b) => b.text().includes('Carregar mais'))
    expect(more).toBeDefined()

    await more!.trigger('click')
    await flushPromises()

    expect(calls(get, list.path)[1]).toEqual({
      params: { query: { limit: PAGE_SIZE, cursor: 'p2' } },
    })
    for (const n of [1, 2, 3]) expect(wrapper.text()).toContain(`${list.label} ${n}`)
    expect(wrapper.findAll('button').some((b) => b.text().includes('Carregar mais'))).toBe(false)
  })
})

describe('useCursorList', () => {
  type Item = { id: number }
  const pages: Record<string, CursorPage<Item>> = {
    first: { data: [{ id: 1 }, { id: 2 }], nextCursor: 'b' },
    b: { data: [{ id: 3 }, { id: 4 }], nextCursor: 'c' },
    c: { data: [{ id: 5 }], nextCursor: null },
  }
  const fetchPage = vi.fn(async ({ cursor }: { limit: number; cursor?: string }) =>
    ok(pages[cursor ?? 'first']!),
  )

  afterEach(() => fetchPage.mockClear())

  it('recarregar traz de novo tantos itens quanto os já carregados', async () => {
    const list = useCursorList<Item>(fetchPage)
    await list.reload()
    await list.loadMore()
    expect(list.items.value.map((i) => i.id)).toEqual([1, 2, 3, 4])

    fetchPage.mockClear()
    await list.reload()
    expect(fetchPage.mock.calls.map(([q]) => q.cursor)).toEqual([undefined, 'b'])
    expect(list.items.value.map((i) => i.id)).toEqual([1, 2, 3, 4])
    expect(list.hasMore.value).toBe(true)
  })

  it('descarta a resposta atrasada de uma recarga anterior', async () => {
    let release: (value: ReturnType<typeof ok<CursorPage<Item>>>) => void = () => {}
    const slow = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockImplementation(async () => ok({ data: [{ id: 9 }], nextCursor: null }))
    const list = useCursorList<Item>(slow)
    const stale = list.reload()
    await list.reload()
    release(ok({ data: [{ id: 1 }], nextCursor: 'b' }))
    await stale
    expect(list.items.value.map((i) => i.id)).toEqual([9])
    expect(list.hasMore.value).toBe(false)
  })

  it('erro ao carregar mais mantém o que já estava na tela e mostra a mensagem', async () => {
    const failing = vi
      .fn()
      .mockResolvedValueOnce(ok(pages.first!))
      .mockResolvedValueOnce({
        data: undefined,
        error: { error: { code: 'INTERNAL', message: 'Falhou no servidor.' } },
      })
    const list = useCursorList<Item>(failing)
    await list.reload()
    await list.loadMore()
    expect(list.items.value.map((i) => i.id)).toEqual([1, 2])
    expect(list.error.value).toBe('Falhou no servidor.')
    expect(list.hasMore.value).toBe(true)
  })
})
