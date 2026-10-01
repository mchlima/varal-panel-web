import { readLocal, writeLocal } from '~/lib/browser'

const PREF_KEY = 'varal.stationAlerts'

/**
 * Alertas de item novo na estação (spec 04, seção 8.2; spec 08, seção 8): som e vibração, com
 * destaque visual sempre. O som só toca depois de uma interação do usuário (política dos
 * navegadores): a tela mostra "Toque para ativar alertas" até o primeiro toque. Os alertas podem
 * ser desligados e a escolha fica neste aparelho.
 */
export function useStationAlerts() {
  const enabled = ref(readLocal(PREF_KEY) !== 'off')
  const unlocked = ref(false)
  let audio: AudioContext | null = null

  const AudioContextClass = (): typeof AudioContext | null => {
    if (typeof window === 'undefined') return null
    return (
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
      null
    )
  }
  const soundSupported = AudioContextClass() !== null

  /** Chamado num toque: libera o áudio (o navegador exige um gesto do usuário). */
  async function unlock(): Promise<void> {
    const Context = AudioContextClass()
    if (!Context) {
      unlocked.value = true
      return
    }
    try {
      audio ??= new Context()
      if (audio.state === 'suspended') await audio.resume()
      unlocked.value = audio.state === 'running'
    } catch {
      unlocked.value = false
    }
  }

  function setEnabled(value: boolean) {
    enabled.value = value
    writeLocal(PREF_KEY, value ? null : 'off')
    if (value) void unlock()
  }

  /** Dois bipes curtos, gerados na hora (sem arquivo de som para baixar). */
  function beep() {
    if (!audio || audio.state !== 'running') return
    const start = audio.currentTime
    for (const offset of [0, 0.22]) {
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.type = 'square'
      oscillator.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16)
      oscillator.connect(gain).connect(audio.destination)
      oscillator.start(start + offset)
      oscillator.stop(start + offset + 0.18)
    }
  }

  /** Item novo chegou: som e vibração, se ligados (o destaque visual é da tela). */
  function notify() {
    if (!enabled.value) return
    try {
      navigator.vibrate?.([200, 100, 200])
    } catch {
      // Sem vibração neste aparelho.
    }
    if (unlocked.value) beep()
  }

  onScopeDispose(() => {
    void audio?.close().catch(() => undefined)
    audio = null
  })

  const needsActivation = computed(() => enabled.value && soundSupported && !unlocked.value)

  return { enabled, unlocked, needsActivation, unlock, setEnabled, notify }
}
