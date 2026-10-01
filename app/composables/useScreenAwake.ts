import { useEventListener } from '@vueuse/core'

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}

/**
 * Tela sempre ligada nas estações (spec 04, seção 8.2): pede o Wake Lock enquanto a tela estiver
 * aberta e de novo quando o app volta ao primeiro plano (o navegador solta o bloqueio ao trocar
 * de app). Se o navegador não tiver a API ou recusar (bateria fraca, permissão), `refused` fica
 * verdadeiro e a tela mostra a dica de ajustar o tempo de tela do aparelho.
 */
export function useScreenAwake() {
  const active = ref(false)
  const refused = ref(false)
  let sentinel: WakeLockSentinelLike | null = null
  let disposed = false

  const wakeLock = (): { request: (type: 'screen') => Promise<WakeLockSentinelLike> } | null => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return null
    return (
      navigator as unknown as {
        wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
      }
    ).wakeLock
  }

  async function request(): Promise<void> {
    const api = wakeLock()
    if (!api) {
      refused.value = true
      return
    }
    if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return
    try {
      sentinel = await api.request('screen')
      if (disposed) {
        void sentinel.release()
        return
      }
      active.value = true
      refused.value = false
      sentinel.addEventListener('release', () => {
        active.value = false
      })
    } catch {
      active.value = false
      refused.value = true
    }
  }

  onMounted(() => void request())
  useEventListener(document, 'visibilitychange', () => {
    if (document.visibilityState === 'visible') void request()
  })
  onScopeDispose(() => {
    disposed = true
    void sentinel?.release().catch(() => undefined)
    sentinel = null
  })

  return { active, refused, request }
}
