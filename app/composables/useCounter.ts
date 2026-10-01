/**
 * Balcão aberto neste aparelho (spec 04, seção 8.1): a estação de balcão escolhida em
 * `/estacoes`, se ainda liberada no `/auth/me` (RN-03.16), e o tempo real do varal: `tab.*` e
 * `shift.*` por `version` (os contadores de prontos e atrasados chegam no `tab.updated`) e
 * recarga por REST a cada reconexão (RN-01.05).
 */
export function useCounterPlace() {
  const session = useSessionStore()
  const workplace = useWorkplaceStore()
  return computed(() => {
    for (const unit of session.me?.units ?? []) {
      const station = unit.stations.find(
        (item) => item.id === workplace.stationId && item.kind === 'counter',
      )
      if (station) return { unit, station }
    }
    return null
  })
}

export function useCounterLive() {
  const place = useCounterPlace()
  const counter = useCounterStore()

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
  useRealtimeEvent('shift.opened', counter.applyShift)
  useRealtimeEvent('shift.updated', counter.applyShift)
  useRealtimeEvent('shift.closed', counter.applyShift)

  return { place, counter }
}
