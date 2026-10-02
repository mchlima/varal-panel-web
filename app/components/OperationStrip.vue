<script setup lang="ts">
import { priceListName, type UnitOperation } from '~/lib/operation'
import { openRegisters } from '~/lib/payment'
import { canOperateCashIn } from '~/lib/routes'

/**
 * Faixa de operação do balcão (spec 04, seção 8.1; spec 08, seção 6): caixa aberto, tabela
 * efetiva ("Preços: Normal" ou, em destaque, "Preços: Evento") e evento em andamento. Para o
 * dono e quem opera caixa, tocar na tabela abre a troca (RN-04.31); durante um evento, a troca
 * explica que a tabela é a do evento (RN-04.32).
 */
const props = defineProps<{ unitId: string; operation: UnitOperation | null }>()
const session = useSessionStore()
const switching = ref(false)

const canSwitch = computed(() => canOperateCashIn(session.me, props.unitId))
const open = computed(() => openRegisters(props.operation?.cashRegisters ?? []))
const cashLabel = computed(() => {
  if (open.value.length === 0) return 'Sem caixa aberto'
  if (open.value.length === 1) return `${open.value[0]!.name} aberto`
  return `${open.value.length} caixas abertos`
})
const effective = computed(() => props.operation?.effectivePriceList ?? null)
const priceLabel = computed(() => `Preços: ${priceListName(effective.value)}`)
</script>

<template>
  <div
    v-if="operation"
    class="border-b border-border bg-surface"
    data-testid="operation-strip"
    aria-label="Situação do balcão"
  >
    <div class="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4 py-2">
      <span
        class="inline-flex min-h-10 items-center gap-1.5 rounded-chip px-2 text-sm font-bold"
        :class="open.length ? 'text-text' : 'bg-status-late-bg text-status-late-text'"
        data-testid="strip-cash"
      >
        <AppIcon :name="open.length ? 'wallet' : 'alert-circle'" :size="18" />
        {{ cashLabel }}
      </span>
      <component
        :is="canSwitch ? 'button' : 'span'"
        :type="canSwitch ? 'button' : undefined"
        class="inline-flex min-h-12 items-center gap-1.5 rounded-chip px-2 text-sm font-bold"
        :class="
          effective
            ? 'bg-primary-soft text-primary-deep'
            : canSwitch
              ? 'border border-border-strong text-text'
              : 'text-text'
        "
        data-testid="strip-price-list"
        @click="canSwitch && (switching = true)"
      >
        <AppIcon name="tag" :size="18" />
        {{ priceLabel }}
        <span v-if="canSwitch" class="font-normal underline">Trocar</span>
      </component>
      <span
        v-if="operation.eventInProgress"
        class="inline-flex min-h-10 items-center gap-1.5 rounded-chip bg-primary-soft px-2 text-sm font-bold text-primary-deep"
        data-testid="strip-event"
      >
        <AppIcon name="party" :size="18" />
        Evento: {{ operation.eventInProgress.contractorName }}
      </span>
    </div>
    <PriceListSwitcher
      v-if="canSwitch"
      v-model:open="switching"
      :unit-id="unitId"
      :operation="operation"
    />
  </div>
</template>
