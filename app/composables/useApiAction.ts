import { explainError, type ExplainedError } from '~/lib/setup'
import { uuidv7 } from '~/lib/uuid'

/**
 * Cadastros do painel (spec 03) são feitos só com conexão: diferente das ações operacionais
 * (spec 01, seção 11), eles não entram na fila offline. Sem rede, a tela diz isso na hora.
 */
export const OFFLINE_SETUP_MESSAGE =
  'Sem conexão. Alterações de cadastro precisam de internet: tente de novo quando a conexão voltar.'

interface FetchResult<T> {
  data?: T
  error?: unknown
  response: Response
}

export type ActionResult<T> = { ok: true; data: T | undefined } | { ok: false }

/**
 * Executa uma escrita na API com estado de "enviando" e erro explicado (mensagem da API
 * mais uma dica para `CASH_REGISTER_OPEN`, `LAST_ACTIVE_UNIT`, `STATION_IN_USE`…).
 */
export function useApiAction() {
  const connection = useConnectionStore()
  const busy = ref(false)
  const error = ref<ExplainedError | null>(null)

  async function run<T>(request: () => Promise<FetchResult<T>>): Promise<ActionResult<T>> {
    error.value = null
    if (!connection.online) {
      error.value = { code: 'OFFLINE', message: OFFLINE_SETUP_MESSAGE, details: {} }
      return { ok: false }
    }
    busy.value = true
    try {
      const result = await request()
      if (result.error !== undefined || !result.response.ok) {
        error.value = explainError(result.error)
        return { ok: false }
      }
      return { ok: true, data: result.data }
    } catch (cause) {
      error.value = explainError(cause)
      return { ok: false }
    } finally {
      busy.value = false
    }
  }

  return { busy, error, run, clear: () => (error.value = null) }
}

/**
 * `Idempotency-Key` das criações (`POST`): a mesma chave enquanto o formulário mandar o mesmo
 * conteúdo (reenviar depois de uma resposta perdida não duplica), uma nova quando muda.
 */
export function useIdempotencyKey() {
  let lastBody = ''
  let key = ''
  return {
    keyFor(body: unknown): string {
      const serialized = JSON.stringify(body)
      if (!key || serialized !== lastBody) {
        key = uuidv7()
        lastBody = serialized
      }
      return key
    },
    reset() {
      key = ''
      lastBody = ''
    },
  }
}
