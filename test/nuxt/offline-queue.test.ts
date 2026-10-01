import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createDatabase } from '~/lib/db'
import { backoffDelay, OfflineQueue, type OfflineQueueOptions } from '~/lib/offline-queue'

const BASE = 'http://api.test'

interface Sent {
  method: string
  path: string
  key: string | null
  body: unknown
}

/** Rede simulada: `online` controla se o fetch rejeita (como o navegador sem conexão). */
function fakeNetwork() {
  const state = { online: true }
  const sent: Sent[] = []
  const reply = vi.fn<(sent: Sent) => Response>(() => new Response(null, { status: 204 }))
  const send = vi.fn(async (request: Request) => {
    if (!state.online) throw new TypeError('Failed to fetch')
    const entry: Sent = {
      method: request.method,
      path: new URL(request.url).pathname,
      key: request.headers.get('Idempotency-Key'),
      body: request.body ? await request.json() : undefined,
    }
    sent.push(entry)
    return reply(entry)
  })
  return { state, sent, send, reply }
}

function setup(overrides: Partial<OfflineQueueOptions> = {}) {
  const db = createDatabase(`queue-${Math.random()}`, { indexedDB: new IDBFactory(), IDBKeyRange })
  const network = fakeNetwork()
  const clock = { now: 1_000_000 }
  const timers: { fn: () => void; at: number }[] = []
  const queue = new OfflineQueue({
    db,
    baseUrl: BASE,
    send: network.send,
    now: () => clock.now,
    random: () => 0.5,
    lock: (task) => task(),
    setTimer: (fn, ms) => {
      const timer = { fn, at: clock.now + ms }
      timers.push(timer)
      return timer
    },
    clearTimer: (handle) => {
      const i = timers.indexOf(handle as (typeof timers)[number])
      if (i >= 0) timers.splice(i, 1)
    },
    ...overrides,
  })
  return { db, queue, network, clock, timers }
}

const advance = {
  method: 'POST' as const,
  path: '/api/v1/order-items/abc/advance',
  body: { expectedVersion: 3 },
  label: 'Avançar 2 Espeto de carne',
}

describe('fila offline (spec 01, seção 11)', () => {
  it('CA-01.07: ação feita sem conexão fica na fila e é enviada uma única vez quando a conexão volta', async () => {
    const { queue, network } = setup()
    network.state.online = false

    const key = await queue.enqueue(advance)
    await queue.trigger()
    expect(network.sent).toHaveLength(0)
    expect(await queue.pending()).toHaveLength(1)

    // Volta a conexão: vários gatilhos ao mesmo tempo (online, socket, visibilidade).
    network.state.online = true
    await queue.resetBackoff()
    await Promise.all([queue.trigger(), queue.trigger(), queue.trigger()])
    await queue.trigger()

    expect(network.sent).toHaveLength(1)
    expect(network.sent[0]).toEqual({
      method: 'POST',
      path: '/api/v1/order-items/abc/advance',
      key,
      body: { expectedVersion: 3 },
    })
    expect(await queue.pending()).toHaveLength(0)
  })

  it('gera a Idempotency-Key no momento da ação e reusa em toda tentativa', async () => {
    const { queue, network, clock } = setup()
    network.reply.mockReturnValueOnce(new Response(null, { status: 503 }))
    const key = await queue.enqueue(advance)
    await queue.trigger()
    clock.now += 60_000
    await queue.trigger()
    expect(network.sent.map((s) => s.key)).toEqual([key, key])
    expect(await queue.pending()).toHaveLength(0)
  })

  it('envia em ordem de chegada', async () => {
    const { queue, network } = setup()
    network.state.online = false
    for (const n of [1, 2, 3]) await queue.enqueue({ ...advance, label: `ação ${n}`, body: { n } })
    network.state.online = true
    await queue.resetBackoff()
    await queue.trigger()
    expect(network.sent.map((s) => s.body)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
  })

  it('4xx (exceto 408 e 429) vira falha definitiva com o motivo da API, e a fila segue', async () => {
    const { queue, network } = setup()
    network.reply.mockImplementationOnce(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'TAB_ALREADY_CLOSED',
              message: 'Esta comanda já foi fechada.',
              details: {},
            },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    await queue.enqueue({ ...advance, label: 'primeira' })
    await queue.enqueue({ ...advance, label: 'segunda' })
    await queue.trigger()

    const failed = await queue.failed()
    expect(failed).toHaveLength(1)
    expect(failed[0]!.label).toBe('primeira')
    expect(failed[0]!.lastError).toEqual({
      status: 409,
      code: 'TAB_ALREADY_CLOSED',
      message: 'Esta comanda já foi fechada.',
    })
    expect(network.sent).toHaveLength(2)
    expect(await queue.pending()).toHaveLength(0)

    await queue.dismiss(failed[0]!.seq!)
    expect(await queue.failed()).toHaveLength(0)
  })

  it.each([408, 429, 500, 503])('%i: tenta de novo depois, sem pular a fila', async (status) => {
    const { queue, network, timers, clock } = setup()
    network.reply.mockReturnValueOnce(new Response(null, { status }))
    await queue.enqueue({ ...advance, body: { n: 1 } })
    await queue.enqueue({ ...advance, body: { n: 2 } })
    await queue.trigger()

    expect(network.sent).toHaveLength(1)
    const [first] = await queue.pending()
    expect(first!.attempts).toBe(1)
    expect(first!.nextAttemptAt).toBeGreaterThan(clock.now)
    expect(timers).toHaveLength(1)

    // O temporizador dispara a nova tentativa.
    clock.now = timers[0]!.at
    timers[0]!.fn()
    await queue.trigger()
    expect(network.sent.map((s) => s.body)).toEqual([{ n: 1 }, { n: 1 }, { n: 2 }])
    expect(await queue.failed()).toHaveLength(0)
  })

  it('IDEMPOTENCY_REQUEST_IN_PROGRESS (409) é tentado de novo, não falha', async () => {
    const { queue, network } = setup()
    network.reply.mockReturnValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS', message: 'Em andamento.', details: {} },
        }),
        { status: 409 },
      ),
    )
    await queue.enqueue(advance)
    await queue.trigger()
    expect(await queue.failed()).toHaveLength(0)
    expect(await queue.pending()).toHaveLength(1)
  })

  it('401 depois da renovação guarda a ação e avisa que a sessão acabou', async () => {
    const onUnauthorized = vi.fn()
    const { queue, network } = setup({ onUnauthorized })
    network.reply.mockImplementation(() => new Response(null, { status: 401 }))
    await queue.enqueue(advance)
    await queue.trigger()
    expect(onUnauthorized).toHaveBeenCalled()
    expect(await queue.failed()).toHaveLength(0)
    expect(await queue.pending()).toHaveLength(1)
  })

  it('só um processador por vez (lock entre abas)', async () => {
    let held = false
    const lock = vi.fn(async (task: () => Promise<void>) => {
      if (held) return // outra aba já processa (ifAvailable)
      held = true
      try {
        await task()
      } finally {
        held = false
      }
    })
    const a = setup({ lock })
    a.network.state.online = false
    await a.queue.enqueue(advance)
    a.network.state.online = true
    await a.queue.resetBackoff()
    await Promise.all([a.queue.trigger(), a.queue.trigger()])
    expect(a.network.sent).toHaveLength(1)
  })
})

describe('espera crescente com jitter', () => {
  it('dobra a cada tentativa, com teto, e varia entre 50% e 100%', () => {
    expect(backoffDelay(1, () => 0)).toBe(500)
    expect(backoffDelay(1, () => 1)).toBe(1_000)
    expect(backoffDelay(3, () => 1)).toBe(4_000)
    expect(backoffDelay(20, () => 1)).toBe(60_000)
    expect(backoffDelay(20, () => 0)).toBe(30_000)
  })
})
