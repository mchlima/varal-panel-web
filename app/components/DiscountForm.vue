<script setup lang="ts">
import { formatCents, parseReais } from '~/lib/money'
import {
  REASON_MAX,
  discountCents,
  discountLabel,
  discountedTotal,
  type DiscountType,
} from '~/lib/payment'

/**
 * Desconto da comanda (spec 05, seção 3 e seção 8): valor em reais ou percentual de 1 a 100,
 * motivo obrigatório e a prévia do novo total (RN-05.03: percentual arredondado para baixo,
 * total nunca negativo). Aplicar de novo substitui o anterior; remover também pede motivo
 * (RN-05.01). O total não pode ficar abaixo do que já foi pago (RN-05.14).
 */
const props = withDefaults(
  defineProps<{
    subtotalCents: number
    paidCents: number
    current: { type: DiscountType; value: number; reason: string | null } | null
    busy?: boolean
  }>(),
  { busy: false },
)
const emit = defineEmits<{
  apply: [value: { type: DiscountType; value: number; reason: string; description: string }]
  remove: [reason: string]
}>()

const type = ref<DiscountType>(props.current?.type ?? 'amount')
const valueInput = ref('')
const reason = ref('')
const removeReason = ref('')
const touched = ref(false)
const removeTouched = ref(false)

const parsedValue = computed<number | null>(() => {
  const text = valueInput.value.trim()
  if (!text) return null
  if (type.value === 'percent') {
    if (!/^\d{1,3}$/.test(text)) return null
    const percent = Number(text)
    return percent >= 1 && percent <= 100 ? percent : null
  }
  const cents = parseReais(text)
  return cents !== null && cents > 0 ? cents : null
})

const valueError = computed(() => {
  if (!touched.value) return ''
  if (!valueInput.value.trim()) return 'Informe o desconto.'
  if (parsedValue.value === null) {
    return type.value === 'percent' ? 'Use um percentual de 1 a 100.' : 'Valor inválido.'
  }
  return ''
})
const reasonError = computed(() => {
  if (!touched.value) return ''
  if (!reason.value.trim()) return 'Diga o motivo do desconto.'
  return ''
})
const removeReasonError = computed(() =>
  removeTouched.value && !removeReason.value.trim() ? 'Diga o motivo da remoção.' : '',
)

const preview = computed(() => {
  if (parsedValue.value === null) return null
  return {
    discount: discountCents(props.subtotalCents, type.value, parsedValue.value),
    total: discountedTotal(props.subtotalCents, type.value, parsedValue.value),
  }
})
const belowPaid = computed(() => preview.value !== null && preview.value.total < props.paidCents)

function setType(next: DiscountType) {
  type.value = next
  valueInput.value = ''
}

function submit() {
  touched.value = true
  if (valueError.value || reasonError.value || parsedValue.value === null || belowPaid.value) {
    return
  }
  emit('apply', {
    type: type.value,
    value: parsedValue.value,
    reason: reason.value.trim(),
    description: discountLabel(type.value, parsedValue.value),
  })
}

function remove() {
  removeTouched.value = true
  if (removeReasonError.value) return
  emit('remove', removeReason.value.trim())
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <p v-if="current" class="rounded-card bg-surface-muted p-3">
        Desconto atual: <strong>{{ discountLabel(current.type, current.value) }}</strong>
        <template v-if="current.reason"> · {{ current.reason }}</template
        >. Aplicar outro substitui este.
      </p>
      <div role="group" aria-label="Tipo de desconto" class="grid grid-cols-2 gap-2">
        <button
          v-for="option in [
            { value: 'amount', label: 'Valor (R$)' },
            { value: 'percent', label: 'Percentual (%)' },
          ] as const"
          :key="option.value"
          type="button"
          :aria-pressed="type === option.value"
          class="min-h-12 rounded-button border-2 px-3 font-bold"
          :class="
            type === option.value
              ? 'border-primary bg-primary-soft text-primary-deep'
              : 'border-border-strong bg-surface'
          "
          @click="setType(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <AppTextField
        v-model="valueInput"
        :label="type === 'percent' ? 'Percentual' : 'Valor do desconto'"
        :inputmode="type === 'percent' ? 'numeric' : 'decimal'"
        :prefix="type === 'percent' ? '%' : 'R$'"
        :error="valueError"
        autocomplete="off"
      />
      <AppTextField
        v-model="reason"
        label="Motivo"
        :maxlength="REASON_MAX"
        :error="reasonError"
        placeholder="Ex.: cliente da casa"
        autocomplete="off"
      />
      <dl class="grid grid-cols-2 gap-1 rounded-card border-2 border-border bg-surface p-3">
        <dt class="text-text-muted">Subtotal</dt>
        <dd class="text-right tabular-nums">{{ formatCents(subtotalCents) }}</dd>
        <dt class="text-text-muted">Desconto</dt>
        <dd class="text-right tabular-nums" data-testid="discount-preview-value">
          {{ preview ? `- ${formatCents(preview.discount)}` : '—' }}
        </dd>
        <dt class="font-bold">Novo total</dt>
        <dd
          class="text-right font-display text-xl font-extrabold tabular-nums"
          data-testid="discount-preview-total"
        >
          {{ preview ? formatCents(preview.total) : formatCents(subtotalCents) }}
        </dd>
      </dl>
      <AppAlert v-if="belowPaid" tone="error">
        O total ficaria abaixo do que já foi pago ({{ formatCents(paidCents) }}). Estorne um
        pagamento antes.
      </AppAlert>
      <AppButton type="submit" :loading="busy" data-testid="apply-discount">
        {{ current ? 'Substituir desconto' : 'Aplicar desconto' }}
      </AppButton>
    </form>

    <form
      v-if="current"
      class="flex flex-col gap-3 border-t border-border pt-4"
      novalidate
      @submit.prevent="remove"
    >
      <h3 class="text-lg">Remover desconto</h3>
      <AppTextField
        v-model="removeReason"
        label="Motivo da remoção"
        :maxlength="REASON_MAX"
        :error="removeReasonError"
        autocomplete="off"
      />
      <AppButton type="submit" variant="secondary" :loading="busy" data-testid="remove-discount">
        Remover desconto
      </AppButton>
    </form>
  </div>
</template>
