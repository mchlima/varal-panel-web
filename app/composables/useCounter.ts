import type { PanelUnit } from '~/stores/session'

/**
 * Balcão aberto neste aparelho (spec 04, seção 8.1): a estação de balcão escolhida em
 * `/estacoes`, se ainda liberada no `/auth/me` (RN-03.16). Sem escolha, vale o único balcão da
 * unidade escolhida (ou da única unidade): é o caso do "Abrir balcão" do painel e do link de
 * uma comanda no aviso do início (RN-01.28).
 */
export function useCounterPlace() {
  const session = useSessionStore()
  const workplace = useWorkplaceStore()
  return computed(() => {
    const units = session.me?.units ?? []
    for (const unit of units) {
      const station = unit.stations.find(
        (item) => item.id === workplace.stationId && item.kind === 'counter',
      )
      if (station) return { unit, station }
    }
    const unit: PanelUnit | undefined =
      units.find((item) => item.id === workplace.unitId) ??
      (units.length === 1 ? units[0] : undefined)
    const counters = unit?.stations.filter((item) => item.kind === 'counter') ?? []
    if (unit && counters.length === 1) return { unit, station: counters[0]! }
    return null
  })
}

/**
 * Varal em tempo real: `tab.*` por `version` (os contadores de prontos e atrasados chegam no
 * `tab.updated`), a situação da operação (caixa aberto, tabela efetiva, evento) e recarga por
 * REST a cada reconexão (RN-01.05).
 */
export function useCounterLive() {
  const place = useCounterPlace()
  const counter = useCounterStore()
  const unitId = computed(() => place.value?.unit.id ?? null)
  const live = useUnitOperation(unitId)

  watch(
    () => (place.value ? `${place.value.unit.id}:${place.value.station.id}` : null),
    (key) => {
      if (key && place.value) void counter.open(place.value.unit.id, place.value.station.id)
    },
    { immediate: true },
  )

  useRealtimeResync(() => counter.load())
  useRealtimeEvent('tab.created', counter.applyTab)
  useRealtimeEvent('tab.updated', counter.applyTab)
  useRealtimeEvent('unit.config_updated', (event) => {
    // O fluxo só muda sem caixa aberto (RN-03.07), mas pode mudar entre um dia e outro.
    if (event.unitId === counter.unitId) void counter.load({ stages: true })
  })

  return { place, counter, operation: live.operation, operationLive: live }
}
