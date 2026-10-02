import { readLocal, writeLocal } from '~/lib/browser'

const KEY = 'varal.panelUnitId'

/**
 * Unidade do painel (início, caixas, cardápio, eventos…; spec 01, seção 14.2). Com uma unidade
 * só, é ela; com mais de uma, a escolhida fica guardada neste aparelho. O dono vê todas; o
 * colaborador, as unidades em que opera caixa ou tem balcão (RN-01.23, fiado da spec 06).
 */
export function usePanelUnit() {
  const session = useSessionStore()
  const selected = useState<string | null>('panel-unit-id', () => readLocal(KEY))
  const units = computed(() =>
    (session.me?.units ?? []).filter(
      (unit) =>
        session.isOwner ||
        unit.canOperateCash ||
        unit.stations.some((station) => station.kind === 'counter'),
    ),
  )
  const unit = computed(
    () => units.value.find((item) => item.id === selected.value) ?? units.value[0] ?? null,
  )

  function select(id: string) {
    selected.value = id
    writeLocal(KEY, id)
  }

  return { units, unit, unitId: computed(() => unit.value?.id ?? null), select }
}
