import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PwaUpdateBanner from '~/components/PwaUpdateBanner.vue'

/** `$pwa` do @vite-pwa/nuxt (reativo); nos testes, controlado à mão. */
function pwa() {
  const nuxtApp = useNuxtApp()
  if (!nuxtApp.$pwa) {
    nuxtApp.provide('pwa', reactive({ needRefresh: false, updateServiceWorker: async () => {} }))
  }
  return nuxtApp.$pwa!
}

afterEach(() => {
  pwa().needRefresh = false
  useConnectionStore().pendingCount = 0
  vi.restoreAllMocks()
})

describe('aviso de nova versão (plano 2.3, registerType prompt)', () => {
  it('não aparece sem versão nova', async () => {
    const wrapper = await mountSuspended(PwaUpdateBanner)
    expect(wrapper.text()).toBe('')
  })

  it('com a fila vazia, "Atualizar" aplica a versão nova', async () => {
    const update = vi.spyOn(pwa(), 'updateServiceWorker').mockResolvedValue()
    pwa().needRefresh = true
    const wrapper = await mountSuspended(PwaUpdateBanner)
    expect(wrapper.text()).toContain('Nova versão disponível')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(true)
  })

  it('com ações na fila, não atualiza (nunca no meio de um pedido)', async () => {
    const update = vi.spyOn(pwa(), 'updateServiceWorker').mockResolvedValue()
    pwa().needRefresh = true
    useConnectionStore().pendingCount = 2
    const wrapper = await mountSuspended(PwaUpdateBanner)
    expect(wrapper.text()).toContain('Atualiza depois que as ações pendentes forem enviadas.')
    const button = wrapper.get('button')
    expect(button.attributes('disabled')).toBeDefined()
    await button.trigger('click')
    expect(update).not.toHaveBeenCalled()
  })
})
