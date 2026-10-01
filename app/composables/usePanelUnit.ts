import { readLocal, writeLocal } from '~/lib/browser'

const KEY = 'varal.panelUnitId'

/**
 * Unidade que o dono está configurando no painel (cardápio). Com uma unidade só, é ela;
 * com mais de uma, a escolhida fica guardada neste aparelho.
 */
export function usePanelUnit() {
  const session = useSessionStore()
  const selected = useState<string | null>('panel-unit-id', () => readLocal(KEY))
  const units = computed(() => session.me?.units ?? [])
  const unit = computed(
    () => units.value.find((item) => item.id === selected.value) ?? units.value[0] ?? null,
  )

  function select(id: string) {
    selected.value = id
    writeLocal(KEY, id)
  }

  return { units, unit, unitId: computed(() => unit.value?.id ?? null), select }
}
