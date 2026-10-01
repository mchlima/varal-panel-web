import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ConnectionBanner from '~/components/ConnectionBanner.vue'

describe('indicador de conexão (spec 01, seções 11 e 14)', () => {
  it('sem conexão e com ações pendentes: "Sem conexão — N ações aguardando envio"', async () => {
    const connection = useConnectionStore()
    connection.online = false
    connection.pendingCount = 3
    const wrapper = await mountSuspended(ConnectionBanner)
    expect(wrapper.get('[data-testid="connection-banner"]').text()).toBe(
      'Sem conexão — 3 ações aguardando envio',
    )
    connection.pendingCount = 1
    await nextTick()
    expect(wrapper.text()).toContain('Sem conexão — 1 ação aguardando envio')
  })

  it('sem conexão e sem pendências: só "Sem conexão"', async () => {
    const connection = useConnectionStore()
    connection.online = false
    connection.pendingCount = 0
    const wrapper = await mountSuspended(ConnectionBanner)
    expect(wrapper.get('[data-testid="connection-banner"]').text()).toBe('Sem conexão')
  })

  it('online e sem pendências: nenhuma faixa', async () => {
    const connection = useConnectionStore()
    connection.online = true
    connection.pendingCount = 0
    connection.failed = []
    const wrapper = await mountSuspended(ConnectionBanner)
    expect(wrapper.find('[data-testid="connection-banner"]').exists()).toBe(false)
  })

  it('ação recusada pela API aparece com o motivo', async () => {
    const connection = useConnectionStore()
    connection.online = true
    connection.pendingCount = 0
    connection.failed = [
      {
        seq: 7,
        idempotencyKey: 'k',
        method: 'POST',
        path: '/x',
        label: 'Avançar 2 Espeto de carne',
        createdAt: 0,
        attempts: 1,
        nextAttemptAt: 0,
        status: 'failed',
        lastError: {
          status: 409,
          code: 'TAB_ALREADY_CLOSED',
          message: 'Esta comanda já foi fechada.',
        },
      },
    ]
    const wrapper = await mountSuspended(ConnectionBanner)
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Não enviada: Avançar 2 Espeto de carne.')
    expect(alert.text()).toContain('Esta comanda já foi fechada.')
    connection.failed = []
  })
})
