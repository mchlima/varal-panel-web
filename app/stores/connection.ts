import { defineStore } from 'pinia'
import type { QueuedAction } from '~/lib/db'
import type { RealtimeStatus } from '~/lib/realtime'

/** Estado da conexão e da fila local, para o indicador do topo (spec 01, seção 14). */
export const useConnectionStore = defineStore('connection', () => {
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const realtime = ref<RealtimeStatus>('idle')
  const pendingCount = ref(0)
  /** Ações ainda não aceitas pela API, em ordem (as telas mostram "Enviando…"/"Na fila"). */
  const pending = ref<QueuedAction[]>([])
  const failed = ref<QueuedAction[]>([])
  /** Falso quando o navegador não oferece IndexedDB: a fila não funciona. */
  const queueAvailable = ref(true)

  return { online, realtime, pendingCount, pending, failed, queueAvailable }
})
