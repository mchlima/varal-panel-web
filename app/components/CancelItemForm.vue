<script setup lang="ts">
import { REASON_MAX } from '~/lib/operation'

/**
 * Cancelar item (RN-04.25, RN-04.26): motivo obrigatório (até 140) e, com quantidade maior que
 * 1, quantas unidades (padrão: todas). Confirmação na própria tela, nunca diálogo do navegador
 * (spec 08, seção 6).
 */
const props = defineProps<{ quantity: number; productName: string; wasteHint?: boolean }>()
const emit = defineEmits<{ submit: [value: { quantity: number; reason: string }]; close: [] }>()

const amount = ref(props.quantity)
const reason = ref('')
const tried = ref(false)
const reasonError = computed(() =>
  tried.value && !reason.value.trim() ? 'Diga o motivo do cancelamento.' : '',
)

function submit() {
  tried.value = true
  if (reasonError.value) return
  emit('submit', { quantity: amount.value, reason: reason.value.trim().slice(0, REASON_MAX) })
}
</script>

<template>
  <form
    class="flex flex-col gap-3 rounded-card border-2 border-status-late-text bg-status-late-bg p-3 text-status-late-text"
    novalidate
    :aria-label="`Cancelar ${productName}`"
    @submit.prevent="submit"
  >
    <p class="font-bold">Cancelar {{ productName }}</p>
    <div v-if="quantity > 1" class="flex flex-wrap items-center gap-3 text-text">
      <span class="font-bold">Quantos?</span>
      <QuantityStepper v-model="amount" :max="quantity" label="Quantidade a cancelar" />
      <span class="text-sm">de {{ quantity }}</span>
    </div>
    <div class="text-text">
      <AppTextField
        v-model="reason"
        label="Motivo"
        :maxlength="REASON_MAX"
        :error="reasonError"
        placeholder="Ex.: cliente desistiu"
      />
    </div>
    <p v-if="wasteHint" class="text-sm">Já saiu da primeira etapa: conta como perda.</p>
    <div class="flex flex-wrap gap-2">
      <button
        type="submit"
        class="min-h-12 rounded-button border-2 border-status-late-text bg-surface px-4 font-bold"
      >
        Cancelar {{ amount === quantity ? 'item' : `${amount} de ${quantity}` }}
      </button>
      <button
        type="button"
        class="min-h-12 rounded-button px-4 font-bold underline"
        @click="emit('close')"
      >
        Voltar
      </button>
    </div>
  </form>
</template>
