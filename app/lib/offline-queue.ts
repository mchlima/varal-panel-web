import { apiErrorCode, apiErrorMessage, isApiErrorBody } from './api-error'
import type { QueuedAction, QueuedActionError, QueuedMethod, VaralDatabase } from './db'
import { uuidv7 } from './uuid'

/**
 * Fila local de ações operacionais (spec 01, seção 11; plano 2.3).
 *
 * - Cada ação guarda a requisição e uma `Idempotency-Key` gerada na hora da ação.
 * - Um único processador envia em ordem (`navigator.locks` impede duas abas ao mesmo tempo).
 * - Rede fora, 5xx, 408 e 429: nova tentativa com espera crescente e jitter, sem pular a fila.
 * - Outros 4xx: falha definitiva, retirada da fila de envio e mostrada com o motivo.
 */

export const QUEUE_LOCK_NAME = 'varal-offline-queue'

export interface EnqueueInput {
  method: QueuedMethod
  path: string
  body?: unknown
  label: string
  /** Dados da tela (ver `QueuedAction.meta`); não vão para a API. */
  meta?: unknown
  /** Normalmente omitida: gerada aqui, no momento da ação. */
  idempotencyKey?: string
}

export interface BackoffOptions {
  baseMs: number
  maxMs: number
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 1_000, maxMs: 60_000 }

/** Resultado de uma ação processada por este aparelho (nesta aba). */
export type QueueOutcome =
  { ok: true; status: number; body: unknown } | { ok: false; error: QueuedActionError }

export type SettledListener = (action: QueuedAction, outcome: QueueOutcome) => void

type LockRunner = (task: () => Promise<void>) => Promise<void>

export interface OfflineQueueOptions {
  db: VaralDatabase
  baseUrl: string
  /** Faz a requisição; no app, o `fetch` da sessão (X-Device-Id e renovação em 401). */
  send: (request: Request) => Promise<Response>
  backoff?: BackoffOptions
  now?: () => number
  random?: () => number
  /**
   * Garante um só processador entre abas. Padrão: `navigator.locks` com `ifAvailable`
   * (se outra aba já processa, esta não faz nada); sem a API, roda direto.
   */
  lock?: LockRunner
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** Chamado quando a API diz que a sessão acabou (401 mesmo depois de renovar). */
  onUnauthorized?: () => void
}

/** Espera antes da tentativa `attempt` (1, 2, 3…): exponencial com teto e jitter de até 50%. */
export function backoffDelay(attempt: number, random: () => number, options = DEFAULT_BACKOFF) {
  const exp = Math.min(options.maxMs, options.baseMs * 2 ** Math.max(0, attempt - 1))
  return Math.round(exp / 2 + random() * (exp / 2))
}

/** Erros 4xx que valem nova tentativa: tempo esgotado e excesso de requisições. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function defaultLock(): LockRunner {
  return async (task) => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks) return task()
    await locks.request(QUEUE_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (lock) await task()
    })
  }
}

async function readError(response: Response): Promise<QueuedActionError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const details =
    isApiErrorBody(body) && typeof body.error.details === 'object' && body.error.details !== null
      ? (body.error.details as Record<string, unknown>)
      : undefined
  return {
    status: response.status,
    code: apiErrorCode(body) ?? `HTTP_${response.status}`,
    message: apiErrorMessage(body, 'A ação foi recusada pelo servidor.'),
    ...(details ? { details } : {}),
  }
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

export class OfflineQueue {
  private readonly db: VaralDatabase
  private readonly options: OfflineQueueOptions
  private readonly now: () => number
  private readonly random: () => number
  private readonly lock: LockRunner
  private running: Promise<void> | null = null
  private rerun = false
  private timer: unknown = null
  private readonly listeners = new Set<SettledListener>()

  constructor(options: OfflineQueueOptions) {
    this.options = options
    this.db = options.db
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.lock = options.lock ?? defaultLock()
  }

  /** Guarda a ação e tenta enviar em seguida. Devolve a `Idempotency-Key`. */
  async enqueue(input: EnqueueInput): Promise<string> {
    const now = this.now()
    const idempotencyKey = input.idempotencyKey ?? uuidv7(now)
    await this.db.queue.add({
      idempotencyKey,
      method: input.method,
      path: input.path,
      body: input.body,
      label: input.label,
      ...(input.meta === undefined ? {} : { meta: input.meta }),
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
      status: 'pending',
    })
    void this.trigger()
    return idempotencyKey
  }

  /**
   * Pede o processamento (rede voltou, app em primeiro plano, intervalo, socket
   * reconectou). Pedidos durante uma rodada geram uma rodada a mais, nunca duas juntas.
   */
  trigger(): Promise<void> {
    if (this.running) {
      this.rerun = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false
          await this.lock(() => this.drain())
        } while (this.rerun)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  /**
   * Avisa quando uma ação é aceita ou recusada de vez por este processador (as telas
   * recarregam o estado ou mostram o motivo). Ações enviadas por outra aba não passam aqui.
   */
  onSettled(listener: SettledListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(action: QueuedAction, outcome: QueueOutcome): void {
    for (const listener of this.listeners) {
      try {
        listener(action, outcome)
      } catch {
        // Um ouvinte com erro não pode travar a fila.
      }
    }
  }

  /** Para o temporizador de nova tentativa (ao sair da sessão ou nos testes). */
  stop(): void {
    if (this.timer !== null) (this.options.clearTimer ?? clearTimeout)(this.timer as never)
    this.timer = null
  }

  pending(): Promise<QueuedAction[]> {
    return this.db.queue.where('status').equals('pending').sortBy('seq')
  }

  failed(): Promise<QueuedAction[]> {
    return this.db.queue.where('status').equals('failed').sortBy('seq')
  }

  /** Tira da tela uma falha definitiva que o usuário já viu. */
  async dismiss(seq: number): Promise<void> {
    const action = await this.db.queue.get(seq)
    if (action?.status === 'failed') await this.db.queue.delete(seq)
  }

  private schedule(at: number): void {
    this.stop()
    const delay = Math.max(0, at - this.now())
    const setTimer = this.options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
    this.timer = setTimer(() => {
      this.timer = null
      void this.trigger()
    }, delay)
  }

  private toRequest(action: QueuedAction): Request {
    const hasBody = action.body !== undefined
    const headers: Record<string, string> = { 'Idempotency-Key': action.idempotencyKey }
    if (hasBody) headers['Content-Type'] = 'application/json'
    return new Request(`${this.options.baseUrl}${action.path}`, {
      method: action.method,
      credentials: 'include',
      headers,
      body: hasBody ? JSON.stringify(action.body) : undefined,
    })
  }

  private async drain(): Promise<void> {
    for (;;) {
      const [next] = await this.pending()
      if (!next || next.seq === undefined) return

      if (next.nextAttemptAt > this.now()) {
        this.schedule(next.nextAttemptAt)
        return
      }

      let response: Response
      try {
        response = await this.options.send(this.toRequest(next))
      } catch {
        await this.retryLater(next)
        return
      }

      if (response.ok) {
        const body = await readBody(response)
        await this.db.queue.delete(next.seq)
        this.notify(next, { ok: true, status: response.status, body })
        continue
      }

      if (response.status === 401) {
        // A sessão acabou mesmo depois de renovar: guarda a ação para depois do login.
        this.options.onUnauthorized?.()
        return
      }

      const error = await readError(response)
      if (isRetryableStatus(response.status) || error.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS') {
        await this.retryLater(next, error)
        return
      }

      await this.db.queue.update(next.seq, { status: 'failed', lastError: error })
      this.notify({ ...next, status: 'failed', lastError: error }, { ok: false, error })
    }
  }

  private async retryLater(action: QueuedAction, error?: QueuedActionError): Promise<void> {
    const attempts = action.attempts + 1
    const nextAttemptAt = this.now() + backoffDelay(attempts, this.random, this.options.backoff)
    await this.db.queue.update(action.seq!, {
      attempts,
      nextAttemptAt,
      ...(error ? { lastError: error } : {}),
    })
    this.schedule(nextAttemptAt)
  }

  /** Quando a rede volta, tenta já, sem esperar o fim da espera crescente. */
  async resetBackoff(): Promise<void> {
    const now = this.now()
    await this.db.queue.where('status').equals('pending').modify({ nextAttemptAt: now })
  }
}
