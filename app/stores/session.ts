import { defineStore } from 'pinia'
import type { components } from '~/api/schema'
import { apiErrorCode, apiErrorMessage } from '~/lib/api-error'
import { readLocal, requestPersistentStorage, writeLocal } from '~/lib/browser'
import { impersonationErrorMessage } from '~/lib/impersonation'
import { hasPanelAccess, homePathFor, isPublicRoute } from '~/lib/routes'

export type PanelMe = components['schemas']['PanelMe']
export type PanelUnit = components['schemas']['PanelUnit']
export type PanelImpersonation = components['schemas']['PanelImpersonation']
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous'

/** Último `/auth/me`, para o app abrir sem rede (PWA) com a sessão que já tinha. */
const ME_CACHE_KEY = 'varal.me'

function readCachedMe(): PanelMe | null {
  const raw = readLocal(ME_CACHE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PanelMe
  } catch {
    return null
  }
}

export interface LoginResult {
  ok: boolean
  /** Mensagem em pt-BR para a tela (a da API, quando houver). */
  message?: string
}

/** Sessão do aparelho: perfil, organização, unidades e estações (`GET /auth/me`). */
export const useSessionStore = defineStore('session', () => {
  const me = ref<PanelMe | null>(null)
  const status = ref<SessionStatus>('unknown')
  /** Verdadeiro quando o perfil veio do cache porque a API não respondeu. */
  const offline = ref(false)

  const isAuthenticated = computed(() => status.value === 'authenticated' && me.value !== null)
  const isOwner = computed(() => me.value?.subject.type === 'owner')
  const homePath = computed(() => homePathFor(me.value))
  /** RN-01.23: dono ou quem opera caixa em alguma unidade. */
  const hasPanel = computed(() => hasPanelAccess(me.value))
  /** Sessão de "entrar como" da equipe do Varal (spec 02, RN-02.19), ou `null`. */
  const impersonation = computed<PanelImpersonation | null>(() => me.value?.impersonation ?? null)
  /** O último "entrar como" deste aparelho terminou (encerrado ou vencido): aviso no login. */
  const impersonationEnded = ref(false)

  function setMe(value: PanelMe) {
    me.value = value
    status.value = 'authenticated'
    offline.value = false
    writeLocal(ME_CACHE_KEY, JSON.stringify(value))
  }

  function clear() {
    me.value = null
    status.value = 'anonymous'
    offline.value = false
    writeLocal(ME_CACHE_KEY, null)
    useWorkplaceStore().clear()
    useAnnouncementsStore().clear()
    useOperationStore().clear()
  }

  /** Carrega a sessão ao abrir o app. Um 401 passa pela renovação do middleware. */
  async function restore(): Promise<void> {
    const { $api } = useNuxtApp()
    try {
      const { data } = await $api.GET('/api/v1/auth/me')
      if (data) setMe(data)
      else if (status.value !== 'authenticated') clear()
    } catch {
      // Sem rede: segue com o último perfil conhecido, se houver.
      const cached = readCachedMe()
      if (cached) {
        me.value = cached
        status.value = 'authenticated'
        offline.value = true
      } else {
        status.value = 'anonymous'
      }
    }
  }

  async function afterLogin(data: PanelMe): Promise<LoginResult> {
    impersonationEnded.value = false
    setMe(data)
    void requestPersistentStorage()
    return { ok: true }
  }

  async function loginOwner(email: string, password: string): Promise<LoginResult> {
    const { $api, $deviceId } = useNuxtApp()
    try {
      const { data, error } = await $api.POST('/api/v1/auth/owner/login', {
        params: { header: { 'X-Device-Id': $deviceId as string } },
        body: { email: email.trim().toLowerCase(), password },
      })
      if (data) return afterLogin(data)
      return { ok: false, message: apiErrorMessage(error) }
    } catch (error) {
      return { ok: false, message: apiErrorMessage(error) }
    }
  }

  async function loginStaff(
    accessCode: string,
    username: string,
    password: string,
  ): Promise<LoginResult> {
    const { $api, $deviceId } = useNuxtApp()
    try {
      const { data, error } = await $api.POST('/api/v1/auth/staff/login', {
        params: { header: { 'X-Device-Id': $deviceId as string } },
        body: {
          accessCode: accessCode.trim().toUpperCase(),
          username: username.trim(),
          password,
        },
      })
      if (data) return afterLogin(data)
      return { ok: false, message: apiErrorMessage(error) }
    } catch (error) {
      return { ok: false, message: apiErrorMessage(error) }
    }
  }

  /**
   * Troca o link do "entrar como" por uma sessão do app como o dono (spec 02, RN-02.21).
   * A API exige, neste navegador, a sessão do admin que gerou o link.
   */
  async function exchangeImpersonation(token: string): Promise<LoginResult> {
    const { $api, $deviceId } = useNuxtApp()
    try {
      const { data, error, response } = await $api.POST('/api/v1/auth/impersonation', {
        params: { header: { 'X-Device-Id': $deviceId as string } },
        body: { token },
      })
      if (data) {
        // Havia outra sessão aberta neste aparelho: a troca de cookies pede um socket novo.
        if (status.value === 'authenticated') clear()
        return afterLogin(data)
      }
      return {
        ok: false,
        message: impersonationErrorMessage(
          response.status,
          apiErrorCode(error),
          apiErrorMessage(error),
        ),
      }
    } catch (error) {
      return { ok: false, message: apiErrorMessage(error) }
    }
  }

  /** "Encerrar acesso" (RN-02.19): o logout desta sessão encerra o "entrar como" na API. */
  async function endImpersonation(): Promise<void> {
    await logout()
    impersonationEnded.value = true
  }

  /** Encerra a sessão do aparelho. Sem rede, limpa o estado local mesmo assim. */
  async function logout(): Promise<void> {
    const { $api } = useNuxtApp()
    try {
      await $api.POST('/api/v1/auth/logout')
    } catch {
      // A sessão no servidor vence sozinha; o aparelho já sai.
    }
    clear()
  }

  /** A renovação foi recusada (ou `session.revoked`): limpa e volta ao login. */
  async function handleSessionLost(): Promise<void> {
    const wasAuthenticated = status.value === 'authenticated'
    // "Entrar como" encerrado pelo admin (CA-02.08; não há prazo, RN-02.17).
    if (me.value?.impersonation) impersonationEnded.value = true
    clear()
    const route = useRoute()
    if (wasAuthenticated && !isPublicRoute(route.path)) {
      await navigateTo('/entrar', { replace: true })
    }
  }

  return {
    me,
    status,
    offline,
    isAuthenticated,
    isOwner,
    homePath,
    hasPanel,
    impersonation,
    impersonationEnded,
    restore,
    exchangeImpersonation,
    endImpersonation,
    loginOwner,
    loginStaff,
    logout,
    clear,
    handleSessionLost,
  }
})
