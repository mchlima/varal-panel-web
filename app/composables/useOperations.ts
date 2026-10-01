import type { QueuedAction, QueuedMethod } from '~/lib/db'
import type { OfflineQueue, QueueOutcome } from '~/lib/offline-queue'
import { operationMeta, type OperationMeta } from '~/lib/operation-actions'
import type { SessionManager } from '~/lib/session'
import {
  NETWORK_ERROR_MESSAGE,
  apiErrorCode,
  apiErrorMessage,
  isApiErrorBody,
} from '~/lib/api-error'
import { uuidv7 } from '~/lib/uuid'

export interface OperationInput {
  method?: QueuedMethod
  path: string
  body?: unknown
  /** Descrição curta em pt-BR, mostrada se a API recusar (ex.: "Avançar 2 Espeto de carne"). */
  label: string
  meta: OperationMeta
}

export interface SubmittedOperation {
  idempotencyKey: string
  /** Resolve quando este aparelho recebe a resposta final da API (nunca rejeita). */
  settled: Promise<QueueOutcome>
}

type Listener = (action: QueuedAction, outcome: QueueOutcome) => void

/** Ouvintes do envio direto (navegador sem IndexedDB, sem fila). */
const directListeners = new Set<Listener>()

/**
 * Escritas operacionais da spec 04 (spec 01, seção 11): todas vão pela fila local com a
 * `Idempotency-Key` gerada aqui, no momento da ação, e reenviadas em ordem quando a rede voltar.
 * A tela mostra o estado pendente a partir da própria fila (`connection.pending`), sem prever o
 * resultado; o estado real chega pela resposta, pelo tempo real ou pelo REST na reconexão.
 *
 * Sem IndexedDB (raro), envia direto, com a mesma chave, e uma recusa aparece na faixa do topo.
 */
export function useOperations() {
  const nuxtApp = useNuxtApp()
  const queue = (nuxtApp.$queue as OfflineQueue | null | undefined) ?? null
  const connection = useConnectionStore()

  function waitFor(key: string): Promise<QueueOutcome> {
    return new Promise((resolve) => {
      const listener: Listener = (action, outcome) => {
        if (action.idempotencyKey !== key) return
        stop()
        resolve(outcome)
      }
      const stop = queue ? queue.onSettled(listener) : addDirect(listener)
    })
  }

  async function sendDirect(action: QueuedAction): Promise<void> {
    const session = nuxtApp.$sessionManager as SessionManager
    const hasBody = action.body !== undefined
    let outcome: QueueOutcome
    try {
      const response = await session.fetch(
        new Request(`${nuxtApp.$apiBaseUrl as string}${action.path}`, {
          method: action.method,
          credentials: 'include',
          headers: {
            'Idempotency-Key': action.idempotencyKey,
            ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
          },
          body: hasBody ? JSON.stringify(action.body) : undefined,
        }),
      )
      let body: unknown
      try {
        body = response.status === 204 ? undefined : await response.json()
      } catch {
        body = undefined
      }
      outcome = response.ok
        ? { ok: true, status: response.status, body }
        : {
            ok: false,
            error: {
              status: response.status,
              code: apiErrorCode(body) ?? `HTTP_${response.status}`,
              message: apiErrorMessage(body, 'A ação foi recusada pelo servidor.'),
              ...(isApiErrorBody(body) ? { details: body.error.details } : {}),
            },
          }
    } catch {
      outcome = { ok: false, error: { status: 0, code: 'NETWORK', message: NETWORK_ERROR_MESSAGE } }
    }
    if (!outcome.ok) {
      connection.failed = [
        ...connection.failed,
        { ...action, seq: -Date.now(), status: 'failed', lastError: outcome.error },
      ]
    }
    for (const listener of directListeners) listener(action, outcome)
  }

  async function submit(input: OperationInput): Promise<SubmittedOperation> {
    const idempotencyKey = uuidv7()
    const settled = waitFor(idempotencyKey)
    const method = input.method ?? 'POST'
    // Cópia simples: dados reativos (Proxy do Vue) não passam pelo IndexedDB.
    const body = plain(input.body)
    const meta = plain(input.meta)
    const now = Date.now()
    const direct = () =>
      sendDirect({
        idempotencyKey,
        method,
        path: input.path,
        body,
        label: input.label,
        meta,
        createdAt: now,
        attempts: 0,
        nextAttemptAt: now,
        status: 'pending',
      })
    if (queue) {
      try {
        await queue.enqueue({
          method,
          path: input.path,
          body,
          label: input.label,
          meta,
          idempotencyKey,
        })
      } catch {
        // IndexedDB indisponível agora (cota, modo privado): envia direto, com a mesma chave.
        void direct()
      }
    } else {
      void direct()
    }
    return { idempotencyKey, settled }
  }

  /**
   * Avisa a tela quando uma ação operacional termina neste aparelho (aceita ou recusada de vez),
   * enquanto ela estiver aberta.
   */
  function onSettled(
    handler: (meta: OperationMeta, outcome: QueueOutcome, action: QueuedAction) => void,
  ) {
    const listener: Listener = (action, outcome) => {
      const meta = operationMeta(action)
      if (meta) handler(meta, outcome, action)
    }
    const stop = queue ? queue.onSettled(listener) : addDirect(listener)
    onScopeDispose(stop)
  }

  /** Tira da faixa do topo uma recusa que a tela já explicou no lugar certo. */
  async function dismissFailure(action: QueuedAction): Promise<void> {
    if (queue && action.seq !== undefined && action.seq >= 0) {
      await queue.dismiss(action.seq)
      return
    }
    connection.failed = connection.failed.filter(
      (item) => item.idempotencyKey !== action.idempotencyKey,
    )
  }

  return { submit, onSettled, dismissFailure }
}

function plain<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function addDirect(listener: Listener): () => void {
  directListeners.add(listener)
  return () => directListeners.delete(listener)
}
