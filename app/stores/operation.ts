import { defineStore } from 'pinia'
import { apiErrorMessage } from '~/lib/api-error'
import type { UnitOperation } from '~/lib/operation'
import type { CashRegister } from '~/lib/payment'

/**
 * Situação da operação de cada unidade (`GET /units/{id}/operation`, spec 04, seção 7): dia de
 * operação, caixas e aberturas, tabela vigente e efetiva, evento em andamento e de hoje,
 * comandas em aberto e as abertas há mais de 2 dias (`staleTabs`, RN-01.28). Usada pelo início
 * do painel (RN-01.24), pelo balcão (faixa de operação, spec 04, seção 8.1) e pelas telas de
 * caixa.
 *
 * O REST é a fonte da verdade (RN-01.05); `unit.operation_updated` troca o estado inteiro quando
 * traz `version` maior, e `cash_register.*` atualiza só o caixa (esperado, responsável), também
 * por `version`.
 */
export const useOperationStore = defineStore('operation', () => {
  const byUnit = ref<Record<string, UnitOperation>>({})
  const loading = ref<Record<string, boolean>>({})
  const errors = ref<Record<string, string>>({})
  const generations: Record<string, number> = {}

  function get(unitId: string | null | undefined): UnitOperation | null {
    return unitId ? (byUnit.value[unitId] ?? null) : null
  }

  /** Troca o estado da unidade se o recebido for mais novo (ou igual, vindo do REST). */
  function apply(operation: UnitOperation, options: { fromRest?: boolean } = {}): boolean {
    const known = byUnit.value[operation.unitId]
    if (
      known &&
      (options.fromRest ? operation.version < known.version : operation.version <= known.version)
    ) {
      return false
    }
    byUnit.value = { ...byUnit.value, [operation.unitId]: operation }
    return true
  }

  async function load(unitId: string): Promise<UnitOperation | null> {
    const { $api } = useNuxtApp()
    const current = (generations[unitId] = (generations[unitId] ?? 0) + 1)
    loading.value = { ...loading.value, [unitId]: true }
    try {
      const { data, error } = await $api.GET('/api/v1/units/{id}/operation', {
        params: { path: { id: unitId } },
      })
      if (current !== generations[unitId]) return get(unitId)
      if (!data) {
        errors.value = { ...errors.value, [unitId]: apiErrorMessage(error) }
        return get(unitId)
      }
      const { [unitId]: _cleared, ...rest } = errors.value
      errors.value = rest
      // O REST manda mesmo com a versão igual: os caixas mudam sem mudar a versão da operação.
      byUnit.value = { ...byUnit.value, [unitId]: data }
      return data
    } catch (error) {
      if (current === generations[unitId]) {
        errors.value = { ...errors.value, [unitId]: apiErrorMessage(error) }
      }
      return get(unitId)
    } finally {
      if (current === generations[unitId]) {
        loading.value = { ...loading.value, [unitId]: false }
      }
    }
  }

  /** `cash_register.*` ou a resposta de abrir e fechar: atualiza o caixa dentro da operação. */
  function applyRegister(register: CashRegister): void {
    const operation = byUnit.value[register.unitId]
    if (!operation) return
    const index = operation.cashRegisters.findIndex((item) => item.id === register.id)
    if (index >= 0 && operation.cashRegisters[index]!.version >= register.version) return
    const cashRegisters = [...operation.cashRegisters]
    if (index >= 0) cashRegisters.splice(index, 1, register)
    else cashRegisters.push(register)
    cashRegisters.sort((a, b) => a.sortOrder - b.sortOrder)
    const inOperation = cashRegisters.some((item) => item.session?.status === 'open')
    byUnit.value = {
      ...byUnit.value,
      [register.unitId]: { ...operation, cashRegisters, inOperation },
    }
  }

  function clear(): void {
    byUnit.value = {}
    loading.value = {}
    errors.value = {}
  }

  return { byUnit, loading, errors, get, apply, load, applyRegister, clear }
})
