import type { PanelUnit } from '~/stores/session'

/**
 * "Abrir balcão" do painel (spec 01, RN-01.24): com um único balcão na unidade, abre o varal
 * dele; com mais de um, a tela pergunta qual (`choices`). Rota normal, para o voltar do
 * navegador trazer de volta ao painel (RN-01.27).
 */
export function useOpenCounter() {
  const workplace = useWorkplaceStore()
  /** Balcões da unidade para a escolha, quando há mais de um. */
  const choices = ref<{ unitId: string; stations: { id: string; name: string }[] } | null>(null)

  async function go(unitId: string, stationId: string): Promise<void> {
    workplace.selectUnit(unitId)
    workplace.selectStation(stationId)
    choices.value = null
    await navigateTo('/balcao')
  }

  async function open(unit: PanelUnit | null | undefined): Promise<void> {
    if (!unit) {
      await navigateTo('/estacoes')
      return
    }
    const counters = unit.stations.filter((station) => station.kind === 'counter')
    if (counters.length === 1) return go(unit.id, counters[0]!.id)
    if (counters.length === 0) {
      workplace.selectUnit(unit.id)
      await navigateTo('/estacoes')
      return
    }
    choices.value = { unitId: unit.id, stations: counters }
  }

  return { open, go, choices }
}
