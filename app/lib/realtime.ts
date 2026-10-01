import type { ManagerOptions, Socket, SocketOptions } from 'socket.io-client'
import type { components } from '../api/schema'
import { apiErrorCode } from './api-error'
import type { RefreshResult } from './session'

type Schemas = components['schemas']
export type EventSessionRevoked = Schemas['EventSessionRevoked']
export type EventSessionExpired = Schemas['EventSessionExpired']
export type RealtimeErrorCode = Schemas['RealtimeErrorCode']

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

export type SocketFactory = (
  url: string,
  options: Partial<ManagerOptions & SocketOptions>,
) => Socket

export interface RealtimeClientOptions {
  url: string
  getDeviceId: () => string
  io: SocketFactory
  /** Renovação compartilhada com o HTTP (`POST /auth/refresh`). */
  refresh: () => Promise<RefreshResult>
  /** Sessão encerrada (`session.revoked` ou renovação recusada): volta ao login. */
  onSessionEnded: (reason: string) => void
  /**
   * A cada conexão e reconexão: recarregar o estado por REST antes de aplicar eventos
   * (RN-01.05) e disparar a fila offline.
   */
  onConnected: () => void
  onStatus?: (status: RealtimeStatus) => void
  /** Espera antes de reconectar depois de uma renovação que falhou por rede. */
  retryDelayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
}

export interface RealtimeClient {
  connect: () => void
  disconnect: () => void
  readonly socket: Socket | null
}

/** Tentativas seguidas de autenticar o socket antes de desistir e mandar para o login. */
const MAX_AUTH_RETRIES = 3

/**
 * Cliente de tempo real conforme o contrato da API (spec 01, seção 10; README da API):
 * `/ws`, só WebSocket, cookie da sessão e `auth.deviceId`.
 */
export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  let socket: Socket | null = null
  let ended = false
  let authRetries = 0
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))

  const status = (value: RealtimeStatus) => options.onStatus?.(value)

  function end(reason: string) {
    if (ended) return
    ended = true
    socket?.disconnect()
    status('disconnected')
    options.onSessionEnded(reason)
  }

  /** Renova por REST e reconecta (o navegador manda o cookie novo no handshake). */
  async function renewAndReconnect() {
    if (ended || !socket) return
    authRetries += 1
    if (authRetries > MAX_AUTH_RETRIES) return end('unauthenticated')
    status('connecting')
    const result = await options.refresh()
    if (ended || !socket) return
    if (result === 'rejected') return end('refresh_rejected')
    if (result === 'renewed') {
      socket.connect()
      return
    }
    // Sem rede: tenta de novo depois, sem gastar as tentativas de autenticação.
    authRetries -= 1
    setTimer(() => {
      if (!ended && socket && !socket.connected) void renewAndReconnect()
    }, options.retryDelayMs ?? 5_000)
  }

  function connect() {
    if (socket) {
      if (!socket.connected) socket.connect()
      return
    }
    ended = false
    authRetries = 0
    status('connecting')
    socket = options.io(options.url, {
      path: '/ws',
      transports: ['websocket'],
      withCredentials: true,
      auth: { deviceId: options.getDeviceId() },
    })

    socket.on('connect', () => {
      authRetries = 0
      status('connected')
      options.onConnected()
    })

    socket.on('session.revoked', (event: EventSessionRevoked) => {
      end(event?.data?.reason ?? 'revoked')
    })

    socket.on('session.expired', () => {
      // O servidor desconecta em seguida ('io server disconnect'); a renovação vem lá.
    })

    socket.on('disconnect', (reason: string) => {
      if (ended) return
      status('disconnected')
      // Desconexão pelo servidor não reconecta sozinha: trata como sessão vencida
      // (session.expired ou evento perdido). As demais o Socket.IO reconecta.
      if (reason === 'io server disconnect') void renewAndReconnect()
    })

    socket.on('connect_error', (error: Error & { data?: unknown }) => {
      if (ended) return
      status('disconnected')
      const code = apiErrorCode(error.data)
      if (code === 'UNAUTHENTICATED' || code === 'DEVICE_ID_REQUIRED') void renewAndReconnect()
      // Outras falhas (rede, servidor fora): o Socket.IO tenta de novo sozinho.
    })
  }

  function disconnect() {
    ended = true
    socket?.removeAllListeners()
    socket?.disconnect()
    socket = null
    status('idle')
  }

  return {
    connect,
    disconnect,
    get socket() {
      return socket
    },
  }
}
