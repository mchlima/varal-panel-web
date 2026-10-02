<script setup lang="ts">
import { CUSTOMER_NAME_MAX } from '~/lib/operation'

import type { TabMode } from '~/lib/operation'

/**
 * Nova comanda (spec 04, seção 8.1; RN-04.10, RN-04.11): "Comanda aberta" (paga no fim) ou
 * "Paga antes" (monta o pedido, recebe e só então envia, RN-05.12) e o nome do cliente, de 1 a
 * 40 caracteres.
 */
withDefaults(
  defineProps<{
    busy?: boolean
    error?: string
    /** Evento em andamento: a comanda nova fica ligada a ele (RN-04.36). */
    eventName?: string | null
  }>(),
  { busy: false, error: '', eventName: null },
)
const emit = defineEmits<{ submit: [customerName: string, mode: TabMode] }>()

const mode = ref<TabMode>('open_tab')
const name = ref('')
const touched = ref(false)
const nameError = computed(() => {
  if (!touched.value) return ''
  const value = name.value.trim()
  if (!value) return 'Diga o nome do cliente.'
  if (value.length > CUSTOMER_NAME_MAX) return `Use até ${CUSTOMER_NAME_MAX} caracteres.`
  return ''
})

function submit() {
  touched.value = true
  if (nameError.value) return
  emit('submit', name.value.trim().replace(/\s+/g, ' '), mode.value)
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
    <fieldset class="flex flex-col gap-2">
      <legend class="mb-2 font-bold">Tipo de comanda</legend>
      <label
        v-for="option in [
          { value: 'open_tab', label: 'Comanda aberta', hint: 'paga no fim' },
          { value: 'pay_first', label: 'Paga antes', hint: 'cobra antes de enviar' },
        ] as const"
        :key="option.value"
        class="flex min-h-14 items-center gap-3 rounded-card border-2 bg-surface px-4 font-bold"
        :class="
          mode === option.value
            ? 'border-primary bg-primary-soft text-primary-deep'
            : 'border-border-strong'
        "
      >
        <input
          v-model="mode"
          type="radio"
          name="mode"
          :value="option.value"
          class="size-5 accent-primary"
        />
        {{ option.label }}
        <span class="ml-auto text-sm font-normal">{{ option.hint }}</span>
      </label>
    </fieldset>
    <AppTextField
      v-model="name"
      label="Nome do cliente"
      autocomplete="off"
      autocapitalize="words"
      :maxlength="CUSTOMER_NAME_MAX"
      :error="nameError"
      hint="Aparece junto do número: 12 · Dona Marta."
    />
    <p
      v-if="eventName"
      class="flex items-center gap-2 rounded-card bg-primary-soft px-3 py-2 font-bold text-primary-deep"
      data-testid="new-tab-event"
    >
      <AppIcon name="party" />
      Esta comanda é do evento {{ eventName }}
    </p>
    <AppAlert v-if="error" tone="error">{{ error }}</AppAlert>
    <AppButton type="submit" :loading="busy">{{
      mode === 'pay_first' ? 'Montar pedido' : 'Abrir comanda'
    }}</AppButton>
  </form>
</template>
