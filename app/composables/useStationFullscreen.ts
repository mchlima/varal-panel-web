import { useEventListener } from '@vueuse/core'

/**
 * Tela cheia da estação (spec 04, seção 8.2): Fullscreen API na página inteira. Sai pelo botão
 * ou pelo gesto do navegador (o primeiro voltar sai da tela cheia, RN-01.27). Sem a API (iPhone),
 * `supported` fica falso e a tela explica que instalar o app já tira as barras do navegador.
 */
export function useStationFullscreen() {
  const active = ref(false)
  const supported = ref(
    typeof document !== 'undefined' &&
      document.fullscreenEnabled === true &&
      typeof document.documentElement.requestFullscreen === 'function',
  )

  function sync() {
    active.value = typeof document !== 'undefined' && document.fullscreenElement != null
  }

  async function enter(): Promise<boolean> {
    if (!supported.value) return false
    try {
      await document.documentElement.requestFullscreen()
      sync()
      return true
    } catch {
      return false
    }
  }

  async function exit(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
    } catch {
      // O navegador já saiu da tela cheia.
    }
    sync()
  }

  if (typeof document !== 'undefined') useEventListener(document, 'fullscreenchange', sync)
  onScopeDispose(() => {
    if (typeof document !== 'undefined' && document.fullscreenElement) void exit()
  })

  return { active, supported, enter, exit }
}
