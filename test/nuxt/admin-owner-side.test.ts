import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnnouncementsBanner from '~/components/AnnouncementsBanner.vue'
import ImpersonationBanner from '~/components/ImpersonationBanner.vue'
import MarkdownView from '~/components/MarkdownView.vue'
import OrganizationStatusBanner from '~/components/OrganizationStatusBanner.vue'
import EntrarComo from '~/pages/entrar-como.vue'
import type { PanelMe } from '~/stores/session'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const ID = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8e'

function me(overrides: Partial<PanelMe> = {}, org: Partial<PanelMe['organization']> = {}): PanelMe {
  return {
    subject: { type: 'owner', id: ID, name: 'Dono do Piloto', email: 'd@v.l', username: null },
    organization: {
      id: ID,
      name: 'Espetinho do Piloto',
      accessCode: 'ESPT26',
      subscriptionStatus: 'active',
      suspendedReason: null,
      ...org,
    },
    units: [],
    session: { id: ID, deviceId: ID, accessTokenExpiresAt: '', expiresAt: '' },
    impersonation: null,
    ...overrides,
  }
}

/** Sem prazo (RN-02.17): a API manda `expiresAt` sempre nulo. */
function impersonating(startedMinutesAgo = 1): PanelMe['impersonation'] {
  return {
    id: ID,
    adminName: 'Bia do Suporte',
    startedAt: new Date(Date.now() - startedMinutesAgo * 60_000).toISOString(),
    expiresAt: null,
  }
}

function apiResponse(status: number, body?: unknown) {
  const response = new Response(body === undefined ? null : JSON.stringify(body), { status })
  return status < 400
    ? { data: body, response, error: undefined }
    : { data: undefined, response, error: body }
}

function signIn(value: PanelMe) {
  const session = useSessionStore()
  session.me = value
  session.status = 'authenticated'
  return session
}

beforeEach(() => {
  navigateToMock.mockReset()
  useAnnouncementsStore().clear()
  useConnectionStore().pendingCount = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('faixa do "entrar como" (spec 02, RN-02.19)', () => {
  it('mostra organização, admin e "Encerrar acesso", sem tempo restante (RN-02.17)', async () => {
    signIn(me({ impersonation: impersonating() }))
    const wrapper = await mountSuspended(ImpersonationBanner)
    expect(wrapper.get('[data-testid="impersonation-text"]').text()).toBe(
      'Você está acessando como Espetinho do Piloto — Bia do Suporte',
    )
    expect(wrapper.find('[data-testid="impersonation-remaining"]').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/Restam|min/)
    expect(wrapper.get('button').text()).toBe('Encerrar acesso')
  })

  it('fora do "entrar como", não aparece', async () => {
    signIn(me())
    const wrapper = await mountSuspended(ImpersonationBanner)
    expect(wrapper.find('[data-testid="impersonation-banner"]').exists()).toBe(false)
  })

  it('"Encerrar acesso" faz o logout desta sessão e volta ao login avisando', async () => {
    const session = signIn(me({ impersonation: impersonating() }))
    const post = vi.spyOn(useNuxtApp().$api, 'POST').mockResolvedValue(apiResponse(204) as never)
    const wrapper = await mountSuspended(ImpersonationBanner)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/api/v1/auth/logout')
    expect(session.status).toBe('anonymous')
    expect(session.impersonationEnded).toBe(true)
    expect(navigateToMock).toHaveBeenCalledWith('/entrar', { replace: true })
  })

  it('sem prazo: depois de horas continua na tela e não recarrega a sessão (RN-02.17)', async () => {
    vi.useFakeTimers()
    try {
      signIn(me({ impersonation: impersonating(5 * 60) }))
      const get = vi.spyOn(useNuxtApp().$api, 'GET')
      const wrapper = await mountSuspended(ImpersonationBanner)
      await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
      expect(get).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="impersonation-banner"]').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('com ações na fila, espera o envio antes de encerrar', async () => {
    signIn(me({ impersonation: impersonating() }))
    useConnectionStore().pendingCount = 2
    const wrapper = await mountSuspended(ImpersonationBanner)
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Espere as ações pendentes serem enviadas')
  })
})

describe('faixa da situação da organização (spec 02, RN-02.12; CA-02.05)', () => {
  it('suspensa: motivo e aviso de que não é possível abrir caixa', async () => {
    signIn(me({}, { subscriptionStatus: 'suspended', suspendedReason: 'Pagamento atrasado' }))
    const wrapper = await mountSuspended(OrganizationStatusBanner)
    const banner = wrapper.get('[data-testid="organization-status-banner"]')
    expect(banner.text()).toContain('Conta suspensa')
    expect(banner.text()).toContain('Motivo: Pagamento atrasado')
    expect(banner.text()).toContain('Não é possível abrir caixa.')
  })

  it('cancelada: mesma faixa com o título da situação', async () => {
    signIn(me({}, { subscriptionStatus: 'canceled', suspendedReason: 'Pedido do cliente' }))
    const wrapper = await mountSuspended(OrganizationStatusBanner)
    expect(wrapper.text()).toContain('Assinatura cancelada')
    expect(wrapper.text()).toContain('Pedido do cliente')
  })

  it.each(['active', 'pilot'] as const)('%s: sem faixa', async (status) => {
    signIn(me({}, { subscriptionStatus: status }))
    const wrapper = await mountSuspended(OrganizationStatusBanner)
    expect(wrapper.find('[data-testid="organization-status-banner"]').exists()).toBe(false)
  })
})

describe('markdown dos comunicados renderizado com segurança (RN-02.13)', () => {
  it('formata o texto e nunca cria elementos de HTML cru', async () => {
    const wrapper = await mountSuspended(MarkdownView, {
      props: {
        source:
          '**Atenção**: <script>alert(1)</script><img src=x onerror="alert(1)">\n\n- [manual](https://varal.app/ajuda)\n- [ruim](javascript:alert(1))',
      },
    })
    const root = wrapper.get('[data-testid="markdown"]')
    expect(root.find('strong').text()).toBe('Atenção')
    expect(root.find('script').exists()).toBe(false)
    expect(root.find('img').exists()).toBe(false)
    expect(root.text()).toContain('<script>alert(1)</script>')
    const links = root.findAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]!.attributes('href')).toBe('https://varal.app/ajuda')
    expect(links[0]!.attributes('rel')).toContain('noopener')
    expect(root.text()).toContain('ruim')
  })
})

describe('comunicados no painel (spec 02, RN-02.16; CA-02.06)', () => {
  const announcement = {
    id: '01a0f6f8-0000-7000-8000-0000000000a1',
    title: 'Manutenção domingo',
    body: 'O app fica **fora do ar** das 3h às 4h.',
    publishedAt: '2026-10-01T12:00:00.000Z',
  }

  it('aparece na faixa, abre e some depois de marcado como lido', async () => {
    signIn(me())
    const get = vi
      .spyOn(useNuxtApp().$api, 'GET')
      .mockResolvedValue(apiResponse(200, { data: [announcement] }) as never)
    const post = vi.spyOn(useNuxtApp().$api, 'POST').mockResolvedValue(apiResponse(204) as never)
    const wrapper = await mountSuspended(AnnouncementsBanner)
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/api/v1/announcements/unread')
    expect(wrapper.get('[data-testid="announcements-banner"]').text()).toContain(
      '1 comunicado novo',
    )

    await wrapper.get('[data-testid="announcements-banner"] button').trigger('click')
    await flushPromises()
    const dialog = document.body.querySelector('[data-testid="announcement"]')
    expect(dialog?.textContent).toContain('fora do ar')
    const markButton = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Marcar como lido',
    )
    markButton!.click()
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/v1/announcements/{id}/read', {
      params: { path: { id: announcement.id } },
    })
    expect(wrapper.find('[data-testid="announcements-banner"]').exists()).toBe(false)
  })

  it('no "entrar como", não pede para registrar a leitura: só fecha nesta sessão', async () => {
    signIn(me({ impersonation: impersonating() }))
    vi.spyOn(useNuxtApp().$api, 'GET').mockResolvedValue(
      apiResponse(200, { data: [announcement] }) as never,
    )
    const post = vi.spyOn(useNuxtApp().$api, 'POST')
    const wrapper = await mountSuspended(AnnouncementsBanner)
    await flushPromises()
    await wrapper.get('[data-testid="announcements-banner"] button').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('a leitura não é registrada')
    const close = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Fechar',
    )
    close!.click()
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="announcements-banner"]').exists()).toBe(false)
  })
})

describe('/entrar-como (spec 02, RN-02.21)', () => {
  it('lê o token do fragmento, apaga da URL, troca pela sessão e abre o painel', async () => {
    useSessionStore().clear()
    window.history.replaceState(null, '', '/entrar-como#token=tok_1234567890abcdefghijkl')
    const withImpersonation = me({ impersonation: impersonating(60) })
    const post = vi
      .spyOn(useNuxtApp().$api, 'POST')
      .mockResolvedValue(apiResponse(200, withImpersonation) as never)
    const get = vi
      .spyOn(useNuxtApp().$api, 'GET')
      .mockResolvedValue(apiResponse(200, withImpersonation) as never)
    await mountSuspended(EntrarComo)
    await flushPromises()
    expect(window.location.hash).toBe('')
    expect(post).toHaveBeenCalledWith('/api/v1/auth/impersonation', {
      params: { header: { 'X-Device-Id': expect.any(String) } },
      body: { token: 'tok_1234567890abcdefghijkl' },
    })
    expect(get).toHaveBeenCalledWith('/api/v1/auth/me')
    expect(navigateToMock).toHaveBeenCalledWith('/painel', { replace: true })
  })

  it('link usado ou vencido: mensagem clara', async () => {
    useSessionStore().clear()
    window.history.replaceState(null, '', '/entrar-como#token=tok_1234567890abcdefghijkl')
    vi.spyOn(useNuxtApp().$api, 'POST').mockResolvedValue(
      apiResponse(400, {
        error: { code: 'INVALID_IMPERSONATION_TOKEN', message: 'Link inválido.' },
      }) as never,
    )
    const wrapper = await mountSuspended(EntrarComo)
    await flushPromises()
    expect(wrapper.get('[data-testid="impersonation-error"]').text()).toContain(
      'já foi usado ou venceu',
    )
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('outro navegador (sem a sessão do admin): explica onde abrir', async () => {
    useSessionStore().clear()
    window.history.replaceState(null, '', '/entrar-como#token=tok_1234567890abcdefghijkl')
    vi.spyOn(useNuxtApp().$api, 'POST').mockResolvedValue(
      apiResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Sem sessão.' } }) as never,
    )
    const wrapper = await mountSuspended(EntrarComo)
    await flushPromises()
    expect(wrapper.get('[data-testid="impersonation-error"]').text()).toContain(
      'só funciona no navegador em que você está logado no admin',
    )
  })

  it('sem token no link: não chama a API', async () => {
    useSessionStore().clear()
    window.history.replaceState(null, '', '/entrar-como')
    const post = vi.spyOn(useNuxtApp().$api, 'POST')
    const wrapper = await mountSuspended(EntrarComo)
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Link incompleto')
  })
})
