import { defineStore } from 'pinia'
import { apiErrorMessage } from '~/lib/api-error'
import { readLocal, writeLocal } from '~/lib/browser'
import type { ContractedEvent } from '~/lib/operation'

const HAS_EVENTS_KEY = 'varal.unitsWithEvents'

function readKnown(): string[] {
  try {
    const parsed = JSON.parse(readLocal(HAS_EVENTS_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * Eventos contratados de cada unidade (`GET /units/{id}/events`, spec 04, seção 3.3). O cadastro
 * é opcional: quem não usa eventos nunca vê nada disso (spec 04, seção 8.3). Por isso o menu do
 * painel só mostra "Eventos" depois que a unidade tem o primeiro evento; a lista de unidades com
 * eventos fica guardada no aparelho para o menu não piscar ao abrir.
 */
export const useContractedEventsStore = defineStore('contractedEvents', () => {
  const byUnit = ref<Record<string, ContractedEvent[]>>({})
  const errors = ref<Record<string, string>>({})
  const loading = ref<Record<string, boolean>>({})
  const known = ref<string[]>(readKnown())

  function remember(unitId: string, has: boolean): void {
    const next = has
      ? [...new Set([...known.value, unitId])]
      : known.value.filter((id) => id !== unitId)
    if (next.length === known.value.length && next.every((id) => known.value.includes(id))) return
    known.value = next
    writeLocal(HAS_EVENTS_KEY, next.length ? JSON.stringify(next) : null)
  }

  function hasEvents(unitId: string | null | undefined): boolean {
    if (!unitId) return false
    const list = byUnit.value[unitId]
    return list ? list.length > 0 : known.value.includes(unitId)
  }

  function eventsOf(unitId: string | null | undefined): ContractedEvent[] {
    return unitId ? (byUnit.value[unitId] ?? []) : []
  }

  async function load(unitId: string): Promise<ContractedEvent[] | null> {
    const { $api } = useNuxtApp()
    loading.value = { ...loading.value, [unitId]: true }
    try {
      const { data, error } = await $api.GET('/api/v1/units/{id}/events', {
        params: { path: { id: unitId } },
      })
      if (!data) {
        errors.value = { ...errors.value, [unitId]: apiErrorMessage(error) }
        return null
      }
      const { [unitId]: _cleared, ...rest } = errors.value
      errors.value = rest
      byUnit.value = { ...byUnit.value, [unitId]: data.data }
      remember(unitId, data.data.length > 0)
      return data.data
    } catch (error) {
      errors.value = { ...errors.value, [unitId]: apiErrorMessage(error) }
      return null
    } finally {
      loading.value = { ...loading.value, [unitId]: false }
    }
  }

  /** Evento criado, editado ou com situação nova (resposta de ação ou `event.updated`). */
  function apply(event: ContractedEvent): void {
    const list = byUnit.value[event.unitId] ?? []
    const index = list.findIndex((item) => item.id === event.id)
    if (index >= 0 && list[index]!.version >= event.version) return
    const next = [...list]
    if (index >= 0) next.splice(index, 1, event)
    else next.push(event)
    byUnit.value = { ...byUnit.value, [event.unitId]: next }
    remember(event.unitId, true)
  }

  function clear(): void {
    byUnit.value = {}
    errors.value = {}
  }

  return { byUnit, errors, loading, known, hasEvents, eventsOf, load, apply, clear }
})
