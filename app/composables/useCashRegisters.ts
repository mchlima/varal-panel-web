import { apiErrorMessage } from '~/lib/api-error'
import { readLocal, writeLocal } from '~/lib/browser'
import { createRegisterList, type LiveCollection } from '~/lib/live-collection'
import type { CashRegister } from '~/lib/payment'
import type {
  EventCashRegisterClosed,
  EventCashRegisterOpened,
  EventCashRegisterUpdated,
} from '~/lib/realtime'

/** Último caixa escolhido neste aparelho (RN-05.05: "o app lembra a última escolha"). */
const CHOICE_KEY = 'varal.cashRegisterId'

/**
 * Caixas do turno (spec 05, seção 5) com o esperado por forma, em tempo real: busca
 * `GET /shifts/{id}/cash-registers` e aplica `cash_register.*` por `version` (eventos que chegam
 * durante a busca são aplicados depois; RN-01.05 na reconexão).
 *
 * Também resolve em qual caixa o balcão recebe (RN-05.05): com um único caixa aberto, ele; com
 * mais de um, o último escolhido neste aparelho, se ainda estiver aberto; senão, nenhum (a tela
 * pede a escolha antes de cobrar).
 */
export function useCashRegisters(shiftId: Ref<string | null>, unitId: Ref<string | null>) {
  const { $api } = useNuxtApp()
  const collection = ref<LiveCollection<CashRegister> | null>(null)
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref('')
  const remembered = ref<string | null>(readLocal(CHOICE_KEY))
  let generation = 0

  const registers = computed<CashRegister[]>(() =>
    collection.value
      ? collection.value
          .list()
          .sort(
            (a, b) =>
              Number(a.status === 'closed') - Number(b.status === 'closed') ||
              a.openedAt.localeCompare(b.openedAt),
          )
      : [],
  )
  const openRegisters = computed(() => registers.value.filter((item) => item.status === 'open'))

  /** Caixa que recebe o próximo pagamento, ou `null` se a tela precisa perguntar. */
  const selectedId = computed<string | null>(() => {
    const open = openRegisters.value
    if (open.length === 1) return open[0]!.id
    return open.some((item) => item.id === remembered.value) ? remembered.value : null
  })
  const needsChoice = computed(() => openRegisters.value.length > 1 && selectedId.value === null)

  function choose(id: string): void {
    remembered.value = id
    writeLocal(CHOICE_KEY, id)
  }

  async function load(): Promise<void> {
    const shift = shiftId.value
    if (!shift) return
    const current = ++generation
    if (!collection.value) collection.value = createRegisterList(shift)
    const live = collection.value as LiveCollection<CashRegister>
    live.beginReload()
    loading.value = true
    error.value = ''
    try {
      const { data, error: failure } = await $api.GET('/api/v1/shifts/{id}/cash-registers', {
        params: { path: { id: shift } },
      })
      if (current !== generation) return
      if (!data) {
        error.value = apiErrorMessage(failure)
        live.abortReload()
        return
      }
      live.finishReload(data.data)
      loaded.value = true
    } catch (cause) {
      if (current !== generation) return
      error.value = apiErrorMessage(cause)
      live.abortReload()
    } finally {
      if (current === generation) loading.value = false
    }
  }

  /** Registro vindo de evento ou de resposta de ação. */
  function apply(register: CashRegister): void {
    if (register.shiftId !== shiftId.value) return
    ;(collection.value as LiveCollection<CashRegister> | null)?.apply(register)
  }

  function onEvent(
    event: EventCashRegisterOpened | EventCashRegisterUpdated | EventCashRegisterClosed,
  ): void {
    if (event.unitId !== unitId.value) return
    apply(event.data)
  }

  watch(
    shiftId,
    (id) => {
      generation += 1
      loaded.value = false
      collection.value = id ? createRegisterList(id) : null
      if (id) void load()
    },
    { immediate: true },
  )

  useRealtimeResync(() => load())
  useRealtimeEvent('cash_register.opened', onEvent)
  useRealtimeEvent('cash_register.updated', onEvent)
  useRealtimeEvent('cash_register.closed', onEvent)

  return {
    registers,
    openRegisters,
    selectedId,
    needsChoice,
    loaded,
    loading,
    error,
    choose,
    load,
    apply,
  }
}
