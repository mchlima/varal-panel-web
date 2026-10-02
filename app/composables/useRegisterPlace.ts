import type { CashRegister } from '~/lib/payment'

/**
 * Caixa cadastrado de `/caixas/{id}/abrir` e `/caixas/{id}/fechar` (spec 01, seção 14.1): acha a
 * unidade dele entre as que a pessoa opera (RN-05.16) pela situação da operação
 * (`GET /units/{id}/operation`) e o mantém em tempo real com `useUnitOperation`.
 */
export function useRegisterPlace(registerId: Ref<string>) {
  const session = useSessionStore()
  const store = useOperationStore()
  const unitId = ref<string | null>(null)
  const searched = ref(false)

  const units = computed(() =>
    (session.me?.units ?? []).filter((unit) => session.isOwner || unit.canOperateCash),
  )

  function unitOf(id: string): string | null {
    for (const [unit, operation] of Object.entries(store.byUnit)) {
      if (operation.cashRegisters.some((register) => register.id === id)) return unit
    }
    return null
  }

  async function resolve(): Promise<void> {
    searched.value = false
    unitId.value = unitOf(registerId.value)
    if (!unitId.value) {
      for (const unit of units.value) {
        await store.load(unit.id)
        unitId.value = unitOf(registerId.value)
        if (unitId.value) break
      }
    }
    searched.value = true
  }

  watch(registerId, () => void resolve(), { immediate: true })
  const live = useUnitOperation(unitId)
  const register = computed<CashRegister | null>(
    () => live.operation.value?.cashRegisters.find((item) => item.id === registerId.value) ?? null,
  )
  const unit = computed(() => units.value.find((item) => item.id === unitId.value) ?? null)
  /** Procurou em todas as unidades e não achou (caixa de outra unidade, desativado ou inexistente). */
  const notFound = computed(() => searched.value && !register.value && !live.loading.value)

  return { unitId, unit, register, notFound, operation: live.operation, reload: live.reload }
}
