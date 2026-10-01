<script setup lang="ts">
import { CUSTOMER_NAME_MAX } from '~/lib/operation'

/**
 * Nova comanda (spec 04, seção 8.1; RN-04.10): nome do cliente de 1 a 40 caracteres. "Paga
 * antes" depende do pagamento (spec 05) e aparece desabilitada até lá.
 */
withDefaults(defineProps<{ busy?: boolean; error?: string }>(), { busy: false, error: '' })
const emit = defineEmits<{ submit: [customerName: string] }>()

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
  emit('submit', name.value.trim().replace(/\s+/g, ' '))
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
    <fieldset class="flex flex-col gap-2">
      <legend class="mb-2 font-bold">Tipo de comanda</legend>
      <label
        class="flex min-h-14 items-center gap-3 rounded-card border-2 border-primary bg-primary-soft px-4 font-bold text-primary-deep"
      >
        <input type="radio" name="mode" value="open_tab" checked class="size-5 accent-primary" />
        Comanda aberta
        <span class="ml-auto text-sm font-normal">paga no fim</span>
      </label>
      <label
        class="flex min-h-14 items-center gap-3 rounded-card border-2 border-border bg-surface-muted px-4 text-text-muted"
      >
        <input type="radio" name="mode" value="pay_first" disabled class="size-5" />
        Paga antes
        <span class="ml-auto text-sm">Disponível em breve</span>
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
    <AppAlert v-if="error" tone="error">{{ error }}</AppAlert>
    <AppButton type="submit" :loading="busy">Abrir comanda</AppButton>
  </form>
</template>
