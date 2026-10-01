import type { Socket } from 'socket.io-client'
import { describe, expect, it, vi } from 'vitest'
import { createRealtimeClient, type RealtimeClientOptions } from '~/lib/realtime'
import type { RefreshResult } from '~/lib/session'

const DEVICE = '0192f000-0000-7000-8000-000000000001'

/** Socket falso: guarda os handlers e deixa o teste disparar eventos do servidor. */
function fakeSocket() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const socket = {
    connected: false,
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), fn])
      return socket
    }),
    connect: vi.fn(() => {
      socket.connected = true
      return socket
    }),
    disconnect: vi.fn(() => {
      socket.connected = false
      return socket
    }),
    removeAllListeners: vi.fn(),
    emit(event: string, ...args: unknown[]) {
      for (const fn of handlers.get(event) ?? []) fn(...args)
    },
  }
  return socket
}

function setup(refresh: () => Promise<RefreshResult> = async () => 'renewed') {
  const socket = fakeSocket()
  const io = vi.fn(() => socket as unknown as Socket)
  const options: RealtimeClientOptions = {
    url: 'http://api.test',
    getDeviceId: () => DEVICE,
    io,
    refresh: vi.fn(refresh),
    onSessionEnded: vi.fn(),
    onConnected: vi.fn(),
    onStatus: vi.fn(),
    setTimer: (fn) => {
      fn()
      return 0
    },
  }
  const client = createRealtimeClient(options)
  client.connect()
  return { socket, io, options, client }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('tempo real (spec 01, seção 10)', () => {
  it('conecta em /ws, só WebSocket, com cookies e o deviceId no auth', () => {
    const { io } = setup()
    expect(io).toHaveBeenCalledWith('http://api.test', {
      path: '/ws',
      transports: ['websocket'],
      withCredentials: true,
      auth: { deviceId: DEVICE },
    })
  })

  it('RN-01.05: a cada conexão e reconexão chama o gancho de recarregar estado e a fila', () => {
    const { socket, options } = setup()
    socket.emit('connect')
    socket.emit('disconnect', 'transport close')
    socket.emit('connect')
    expect(options.onConnected).toHaveBeenCalledTimes(2)
    expect(options.onStatus).toHaveBeenLastCalledWith('connected')
  })

  it('session.revoked volta ao login (CA-01.05)', () => {
    const { socket, options } = setup()
    socket.emit('session.revoked', { type: 'session.revoked', data: { reason: 'logout' } })
    socket.emit('disconnect', 'io server disconnect')
    expect(options.onSessionEnded).toHaveBeenCalledWith('logout')
    expect(options.refresh).not.toHaveBeenCalled()
  })

  it('session.expired / io server disconnect: renova por REST e reconecta', async () => {
    const { socket, options } = setup()
    socket.emit('session.expired', { type: 'session.expired' })
    socket.emit('disconnect', 'io server disconnect')
    await flush()
    expect(options.refresh).toHaveBeenCalledOnce()
    expect(socket.connect).toHaveBeenCalledOnce()
    expect(options.onSessionEnded).not.toHaveBeenCalled()
  })

  it('renovação recusada manda para o login', async () => {
    const { socket, options } = setup(async () => 'rejected')
    socket.emit('disconnect', 'io server disconnect')
    await flush()
    expect(options.onSessionEnded).toHaveBeenCalledWith('refresh_rejected')
  })

  it('connect_error UNAUTHENTICATED renova e tenta de novo; outras falhas ficam com o Socket.IO', async () => {
    const { socket, options } = setup()
    const error = Object.assign(new Error('x'), {
      data: { error: { code: 'UNAUTHENTICATED', message: 'Sessão expirada.', details: {} } },
    })
    socket.emit('connect_error', error)
    await flush()
    expect(options.refresh).toHaveBeenCalledOnce()
    expect(socket.connect).toHaveBeenCalledOnce()

    socket.emit('connect_error', new Error('websocket error'))
    await flush()
    expect(options.refresh).toHaveBeenCalledOnce()
  })

  it('desiste depois de várias falhas seguidas de autenticação', async () => {
    const { socket, options } = setup()
    const error = Object.assign(new Error('x'), {
      data: { error: { code: 'UNAUTHENTICATED', message: 'x', details: {} } },
    })
    for (let i = 0; i < 4; i++) {
      socket.emit('connect_error', error)
      await flush()
    }
    expect(options.onSessionEnded).toHaveBeenCalledWith('unauthenticated')
  })

  it('disconnect() encerra o socket e para de reagir', () => {
    const { socket, client, options } = setup()
    client.disconnect()
    expect(socket.disconnect).toHaveBeenCalled()
    expect(client.socket).toBeNull()
    expect(options.onStatus).toHaveBeenLastCalledWith('idle')
  })
})
