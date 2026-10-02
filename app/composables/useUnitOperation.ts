import type { UnitOperation } from '~/lib/operation'
import { openRegisters } from '~/lib/payment'

/**
 * Situação da operação de uma unidade, em tempo real (spec 04, seção 7): carrega por REST ao
 * abrir a tela e a cada reconexão (RN-01.05) e aplica `unit.operation_updated` e
 * `cash_register.*` por `version`. `event.updated` de um evento da unidade recarrega (a tabela
 * do evento em andamento pode ter mudado, RN-04.37).
 */
export function useUnitOperation(
  unitId: Ref<string | null | undefined>,
  options: { trackTabs?: boolean } = {},
) {
  const store = useOperationStore()
  const operation = computed<UnitOperation | null>(() => store.get(unitId.value))
  const loaded = computed(() => operation.value !== null)
  const error = computed(() => (unitId.value ? (store.errors[unitId.value] ?? '') : ''))
  const loading = computed(() => (unitId.value ? store.loading[unitId.value] === true : false))
  let timer: ReturnType<typeof setTimeout> | null = null

  function reload(): Promise<UnitOperation | null> {
    return unitId.value ? store.load(unitId.value) : Promise.resolve(null)
  }

  function reloadSoon(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void reload()
    }, 300)
  }

  watch(
    () => unitId.value,
    (id) => {
      if (id) void store.load(id)
    },
    { immediate: true },
  )

  useRealtimeResync(async () => {
    await reload()
  })
  useRealtimeEvent('unit.operation_updated', (event) => {
    store.apply(event.data)
  })
  const onRegister = (event: { data: Parameters<typeof store.applyRegister>[0] }) => {
    store.applyRegister(event.data)
  }
  useRealtimeEvent('cash_register.opened', onRegister)
  useRealtimeEvent('cash_register.updated', onRegister)
  useRealtimeEvent('cash_register.closed', onRegister)
  useRealtimeEvent('event.updated', (event) => {
    if (event.unitId === unitId.value) reloadSoon()
  })
  if (options.trackTabs) {
    // Início do painel: contadores de comandas em aberto e `staleTabs` (RN-01.28) mudam com a
    // comanda (o aviso some quando ela é paga, pendurada ou cancelada, CA-01.19).
    const onTab = (event: { unitId: string; data: { status: string } }) => {
      if (event.unitId === unitId.value) reloadSoon()
    }
    useRealtimeEvent('tab.created', onTab)
    useRealtimeEvent('tab.updated', onTab)
  }

  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
  })

  /** Caixas com abertura em andamento, na ordem do cadastro. */
  const openCashRegisters = computed(() => openRegisters(operation.value?.cashRegisters ?? []))

  return { operation, loaded, loading, error, reload, openCashRegisters }
}
