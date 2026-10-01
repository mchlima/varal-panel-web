import type { ManagerOptions, Socket, SocketOptions } from 'socket.io-client'
import type { components } from '../api/schema'
import { apiErrorCode } from './api-error'
import type { RefreshResult } from './session'

type Schemas = components['schemas']
export type EventSessionRevoked = Schemas['EventSessionRevoked']
export type EventSessionExpired = Schemas['EventSessionExpired']
export type EventSessionAccessChanged = Schemas['EventSessionAccessChanged']
export type EventProductSoldOutChanged = Schemas['EventProductSoldOutChanged']
export type EventMenuUpdated = Schemas['EventMenuUpdated']
export type EventUnitConfigUpdated = Schemas['EventUnitConfigUpdated']
export type EventShiftOpened = Schemas['EventShiftOpened']
export type EventShiftUpdated = Schemas['EventShiftUpdated']
export type EventShiftClosed = Schemas['EventShiftClosed']
export type EventTabCreated = Schemas['EventTabCreated']
export type EventTabUpdated = Schemas['EventTabUpdated']
export type EventOrderCreated = Schemas['EventOrderCreated']
export type EventOrderItemStageChanged = Schemas['EventOrderItemStageChanged']
export type EventOrderItemCanceled = Schemas['EventOrderItemCanceled']
export type EventOrderCompleted = Schemas['EventOrderCompleted']
export type EventCashRegisterOpened = Schemas['EventCashRegisterOpened']
export type EventCashRegisterUpdated = Schemas['EventCashRegisterUpdated']
export type EventCashRegisterClosed = Schemas['EventCashRegisterClosed']

/**
 * Eventos de unidade e de estação que as telas ouvem (spec 03, seção 8; spec 04, seção 7.1;
 * spec 05, seção 7; README da API).
 */
export interface UnitEvents {
  'product.sold_out_changed': EventProductSoldOutChanged
  'menu.updated': EventMenuUpdated
  'unit.config_updated': EventUnitConfigUpdated
  'shift.opened': EventShiftOpened
  'shift.updated': EventShiftUpdated
  'shift.closed': EventShiftClosed
  'tab.created': EventTabCreated
  'tab.updated': EventTabUpdated
  'order.created': EventOrderCreated
  'order_item.stage_changed': EventOrderItemStageChanged
  'order_item.canceled': EventOrderItemCanceled
  'order.completed': EventOrderCompleted
  'cash_register.opened': EventCashRegisterOpened
  'cash_register.updated': EventCashRegisterUpdated
  'cash_register.closed': EventCashRegisterClosed
}
export type UnitEventName = keyof UnitEvents
export type EventHandler<T = unknown> = (payload: T) => void
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
  /**
   * `session.access_changed` (spec 01, seção 10; spec 03): a sessão continua válida, mas
   * as salas mudaram. O app recarrega o `/auth/me`; depois o socket reconecta.
   */
  onAccessChanged?: () => Promise<void>
  onStatus?: (status: RealtimeStatus) => void
  /** Espera antes de reconectar depois de uma renovação que falhou por rede. */
  retryDelayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
}

export interface RealtimeClient {
  connect: () => void
  disconnect: () => void
  /**
   * Ouve um evento do servidor, inclusive em sockets criados depois (novo login).
   * Devolve a função que para de ouvir.
   */
  subscribe: <T = unknown>(event: string, handler: EventHandler<T>) => () => void
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
  /** O servidor avisou `session.access_changed`: a próxima desconexão não é sessão vencida. */
  let accessChanged = false
  const handlers = new Map<string, Set<EventHandler>>()
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

  function dispatcherFor(event: string): EventHandler {
    return (payload) => {
      for (const handler of handlers.get(event) ?? []) handler(payload)
    }
  }

  function subscribe<T>(event: string, handler: EventHandler<T>): () => void {
    let set = handlers.get(event)
    if (!set) {
      set = new Set()
      handlers.set(event, set)
      socket?.on(event, dispatcherFor(event))
    }
    set.add(handler as EventHandler)
    return () => {
      set.delete(handler as EventHandler)
    }
  }

  /** Recarrega o acesso (`/auth/me`) e reconecta, entrando nas salas novas. */
  async function reloadAccessAndReconnect() {
    accessChanged = false
    status('connecting')
    try {
      await options.onAccessChanged?.()
    } catch {
      // Sem rede: a reconexão abaixo tenta de novo e o resync recarrega depois.
    }
    if (!ended && socket && !socket.connected) socket.connect()
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

    socket.on('session.access_changed', () => {
      accessChanged = true
    })

    socket.on('session.expired', () => {
      // O servidor desconecta em seguida ('io server disconnect'); a renovação vem lá.
    })

    socket.on('disconnect', (reason: string) => {
      if (ended) return
      status('disconnected')
      // Desconexão pelo servidor não reconecta sozinha: trata como sessão vencida
      // (session.expired ou evento perdido). As demais o Socket.IO reconecta.
      if (reason !== 'io server disconnect') return
      if (accessChanged) void reloadAccessAndReconnect()
      else void renewAndReconnect()
    })

    for (const event of handlers.keys()) socket.on(event, dispatcherFor(event))

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
    subscribe,
    get socket() {
      return socket
    },
  }
}
