import Dexie, { type DexieOptions, type EntityTable } from 'dexie'

/** Situação de uma ação na fila local (spec 01, seção 11). */
export type QueuedActionStatus = 'pending' | 'failed'

export type QueuedMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Motivo de uma falha definitiva, no formato de erro da API (spec 01, seção 5). */
export interface QueuedActionError {
  status: number
  code: string
  message: string
}

/**
 * Ação operacional guardada no aparelho até ser aceita pela API.
 * A `idempotencyKey` é gerada no momento da ação e nunca muda, para que um
 * reenvio depois de resposta perdida não duplique nada (spec 01, seção 5).
 */
export interface QueuedAction {
  /** Ordem de chegada; o processador envia sempre pela menor. */
  seq?: number
  idempotencyKey: string
  method: QueuedMethod
  /** Caminho da API a partir da base, ex.: `/api/v1/order-items/{id}/advance`. */
  path: string
  body?: unknown
  /** Descrição curta em pt-BR para a interface (ex.: "Avançar 2 Espeto de carne"). */
  label: string
  createdAt: number
  attempts: number
  nextAttemptAt: number
  status: QueuedActionStatus
  lastError?: QueuedActionError
}

interface MetaEntry {
  key: string
  value: string
}

export type VaralDatabase = Dexie & {
  queue: EntityTable<QueuedAction, 'seq'>
  meta: EntityTable<MetaEntry, 'key'>
}

export const DATABASE_NAME = 'varal'

/** Abre o banco local do app. `options` permite injetar um IndexedDB falso nos testes. */
export function createDatabase(name = DATABASE_NAME, options?: DexieOptions): VaralDatabase {
  const db = new Dexie(name, options) as VaralDatabase
  db.version(1).stores({
    queue: '++seq, status, idempotencyKey',
    meta: 'key',
  })
  return db
}
