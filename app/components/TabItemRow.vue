<script setup lang="ts">
import { formatCents } from '~/lib/money'
import {
  isItemLate,
  isReadyToDeliver,
  minutesSince,
  stageTone,
  type OrderItem,
  type WorkflowStage,
} from '~/lib/operation'

/**
 * Item na comanda (spec 04, seção 8.1): etapa com chip de status (texto e ícone, spec 08),
 * atraso calculado com o relógio (RN-04.23), "Entregue" nos itens prontos (RN-04.21) e cancelar
 * com motivo, também parcial (RN-04.25, RN-04.26). Ações pendentes aparecem como "Enviando…" ou
 * "Na fila" e travam o item até a API responder (spec 01, seção 11).
 */
const props = withDefaults(
  defineProps<{
    item: OrderItem
    stages: readonly WorkflowStage[]
    now: number
    editable: boolean
    pending?: string
    notice?: string
    /**
     * Número da comanda quando ela está paga (RN-04.28, RN-05.14): cancelar o item vira o
     * roteiro estornar → cancelar → receber de novo, explicado no próprio item.
     */
    paidTabNumber?: number | null
  }>(),
  { pending: undefined, notice: undefined, paidTabNumber: null },
)
const emit = defineEmits<{
  deliver: []
  cancel: [value: { quantity: number; reason: string }]
  dismissNotice: []
}>()

const canceling = ref(false)
const explainingPaid = ref(false)
const canceled = computed(() => props.item.canceledAt !== null)
const late = computed(() => isItemLate(props.item, props.now))
const ready = computed(() => isReadyToDeliver(props.stages, props.item))
const tone = computed(() => stageTone(props.stages, props.item))
const wasteHint = computed(() => {
  const first = props.stages[0]
  return first !== undefined && props.item.stageId !== first.id
})

function cancel(value: { quantity: number; reason: string }) {
  canceling.value = false
  emit('cancel', value)
}
</script>

<template>
  <li
    class="flex flex-col gap-2 border-t border-border py-3 first:border-t-0"
    data-testid="tab-item"
    :data-item-id="item.id"
    :data-stage="item.stageName"
  >
    <div class="flex items-start gap-3">
      <span
        class="min-w-10 font-display text-xl font-extrabold tabular-nums"
        :class="canceled ? 'text-text-muted line-through' : ''"
        >{{ item.quantity }}×</span
      >
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="text-lg font-bold" :class="canceled ? 'text-text-muted line-through' : ''">{{
          item.productName
        }}</span>
        <span v-if="item.modifiers.length" class="text-sm text-text-muted">
          {{ item.modifiers.map((modifier) => modifier.modifierName).join(', ') }}
        </span>
        <span v-if="item.note" class="text-sm font-bold">Obs.: {{ item.note }}</span>
        <span class="flex flex-wrap items-center gap-1.5">
          <StageChip v-if="canceled" status="canceled" label="Cancelado" />
          <StageChip v-else :status="tone" :label="item.stageName" />
          <StageChip
            v-if="late"
            status="late"
            :label="`Atrasado · ${minutesSince(item.sentAt, now)} min`"
          />
          <StageChip v-if="pending" status="pending" :label="pending" />
        </span>
        <span v-if="canceled && item.cancelReason" class="text-sm text-text-muted">
          Motivo: {{ item.cancelReason }}<template v-if="item.wasted"> · perda</template>
        </span>
      </div>
      <span
        class="font-bold whitespace-nowrap tabular-nums"
        :class="canceled ? 'text-text-muted line-through' : ''"
        >{{ formatCents(item.totalCents) }}</span
      >
    </div>

    <AppAlert v-if="notice" tone="error">
      <p>{{ notice }}</p>
      <button
        type="button"
        class="mt-1 min-h-12 font-bold underline"
        @click="emit('dismissNotice')"
      >
        Entendi
      </button>
    </AppAlert>

    <div v-if="editable && !canceled && !canceling" class="flex flex-wrap items-center gap-2 pl-13">
      <AppButton
        v-if="ready"
        variant="secondary"
        :block="false"
        :disabled="!!pending"
        data-testid="deliver"
        @click="emit('deliver')"
      >
        <AppIcon name="check" />
        Entregue
      </AppButton>
      <button
        type="button"
        class="min-h-12 rounded-button px-3 font-bold text-status-late-text underline-offset-4 hover:underline disabled:opacity-50"
        :disabled="!!pending"
        data-testid="cancel-item"
        @click="paidTabNumber !== null ? (explainingPaid = !explainingPaid) : (canceling = true)"
      >
        Cancelar item
      </button>
    </div>
    <AppAlert v-if="explainingPaid && paidTabNumber !== null">
      <div data-testid="paid-cancel-guide">
        <p class="font-bold">Esta comanda já está paga.</p>
        <ol class="mt-1 list-decimal pl-5">
          <li>Estorne o pagamento (a comanda volta para "Fechando").</li>
          <li>Cancele o item aqui.</li>
          <li>Receba de novo o valor certo.</li>
        </ol>
        <NuxtLink
          :to="`/balcao/comandas/${paidTabNumber}/receber`"
          class="mt-1 inline-flex min-h-12 items-center font-bold underline"
          >Ir para o estorno</NuxtLink
        >
      </div>
    </AppAlert>
    <CancelItemForm
      v-if="canceling"
      :quantity="item.quantity"
      :product-name="item.productName"
      :waste-hint="wasteHint"
      @submit="cancel"
      @close="canceling = false"
    />
  </li>
</template>
