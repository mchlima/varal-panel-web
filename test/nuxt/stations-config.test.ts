import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { components } from '~/api/schema'
import StationsManager from '~/components/StationsManager.vue'

type Station = components['schemas']['Station']

const UNIT = '0192f000-0000-7000-8000-0000000000f1'
const KITCHEN = '0192f000-0000-7000-8000-0000000000a1'
const stations: Station[] = [
  {
    id: KITCHEN,
    unitId: UNIT,
    name: 'Cozinha',
    kind: 'queue',
    sortOrder: 1,
    active: true,
    attentionAfterMinutes: 7,
    lateAfterMinutes: 15,
  },
]

afterEach(() => vi.restoreAllMocks())

async function editKitchen() {
  const wrapper = await mountSuspended(StationsManager, { props: { unitId: UNIT, stations } })
  const edit = wrapper.findAll('button').find((button) => button.text().includes('Editar'))!
  await edit.trigger('click')
  return wrapper
}

function field(wrapper: Awaited<ReturnType<typeof editKitchen>>, label: string) {
  const id = wrapper
    .findAll('label')
    .find((item) => item.text().includes(label))!
    .attributes('for')
  return wrapper.get(`#${id}`)
}

describe('limites de tempo da estação (RN-03.25)', () => {
  it('mostra atenção e atraso de cada fila, com texto e ícone', async () => {
    const wrapper = await mountSuspended(StationsManager, { props: { unitId: UNIT, stations } })
    const limits = wrapper.get('[data-testid="station-limits"]').text()
    expect(limits).toContain('Atenção: 7 min')
    expect(limits).toContain('Atrasado: 15 min')
  })

  it('CA-03.12: atenção maior ou igual ao atraso é recusada na tela, sem enviar', async () => {
    const patch = vi.spyOn(useNuxtApp().$api, 'PATCH')
    const wrapper = await editKitchen()
    await field(wrapper, 'Atenção a partir de').setValue('15')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('A atenção precisa vir antes do atraso')
    expect(patch).not.toHaveBeenCalled()
  })

  it('manda só o limite que mudou (vale mesmo com caixa aberto)', async () => {
    const patch = vi.spyOn(useNuxtApp().$api, 'PATCH').mockResolvedValue({
      data: stations[0],
      error: undefined,
      response: new Response('{}'),
    } as never)
    const wrapper = await editKitchen()
    await field(wrapper, 'Atenção a partir de').setValue('10')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/api/v1/stations/{id}', {
      params: { path: { id: KITCHEN } },
      body: { attentionAfterMinutes: 10 },
    })
  })
})
