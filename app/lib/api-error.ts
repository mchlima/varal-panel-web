import type { components } from '../api/schema'

export type ApiErrorBody = components['schemas']['ErrorResponse']

export const NETWORK_ERROR_MESSAGE =
  'Sem conexão com o servidor. Confira a internet e tente de novo.'
export const UNKNOWN_ERROR_MESSAGE = 'Algo deu errado. Tente de novo em instantes.'

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const error = (value as { error: unknown }).error
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  )
}

/** Código estável do erro da API (spec 01, seção 5), ou `undefined`. */
export function apiErrorCode(value: unknown): string | undefined {
  return isApiErrorBody(value) ? value.error.code : undefined
}

/**
 * Texto para mostrar ao usuário: a `message` em pt-BR da API (spec 01, seção 5).
 * Erros de rede (o `fetch` rejeita) viram uma mensagem própria.
 */
export function apiErrorMessage(value: unknown, fallback = UNKNOWN_ERROR_MESSAGE): string {
  if (isApiErrorBody(value) && value.error.message.trim()) return value.error.message
  if (value instanceof TypeError) return NETWORK_ERROR_MESSAGE
  return fallback
}
