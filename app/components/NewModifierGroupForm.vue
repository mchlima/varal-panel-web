<script setup lang="ts">
import { parseReais } from '~/lib/money'
import { modifierLimitsError, parseInteger } from '~/lib/setup'
import { uuidv7 } from '~/lib/uuid'

/**
 * Novo grupo de modificadores com as opções (spec 03, seção 5.2; RN-03.13). Exemplos:
 * "Ponto da carne" (mínimo 1, máximo 1) e "Retirar" (mínimo 0, opções de acréscimo zero,
 * RN-03.14).
 */
const props = defineProps<{ productId: string }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()

const { $api } = useNuxtApp()
const action = useApiAction()
const idempotency = useIdempotencyKey()

const form = reactive({ name: '', min: '0', max: '1' })
const options = ref([{ key: uuidv7(), name: '', price: '0,00' }])
const error = ref('')

function addOption() {
  options.value = [...options.value, { key: uuidv7(), name: '', price: '0,00' }]
}

function removeOption(key: string) {
  options.value = options.value.filter((option) => option.key !== key)
}

async function save() {
  const min = parseInteger(form.min)
  const max = parseInteger(form.max)
  const filled = options.value.filter((option) => option.name.trim())
  const prices = filled.map((option) => parseReais(option.price))
  error.value = !form.name.trim()
    ? 'Informe o nome do grupo.'
    : min === null || max === null
      ? 'Use números inteiros no mínimo e no máximo.'
      : (modifierLimitsError(min, max) ??
        (filled.length === 0
          ? 'Adicione pelo menos uma opção.'
          : prices.includes(null)
            ? 'Confira os acréscimos (ex.: 3,00). Use 0 para nenhum.'
            : ''))
  if (error.value || min === null || max === null) return
  const body = {
    productId: props.productId,
    name: form.name.trim(),
    minChoices: min,
    maxChoices: max,
    modifiers: filled.map((option, index) => ({
      name: option.name.trim(),
      priceDeltaCents: prices[index] ?? 0,
    })),
  }
  const result = await action.run(() =>
    $api.POST('/api/v1/modifier-groups', {
      params: { header: { 'Idempotency-Key': idempotency.keyFor(body) } },
      body,
    }),
  )
  if (result.ok) {
    idempotency.reset()
    emit('saved')
  }
}
</script>

<template>
  <form
    class="flex flex-col gap-3 rounded-card border-2 border-primary bg-surface p-3"
    novalidate
    aria-label="Novo grupo de modificadores"
    @submit.prevent="save"
  >
    <h4 class="font-display text-lg font-semibold">Novo grupo</h4>
    <AppTextField
      v-model="form.name"
      label="Nome do grupo"
      hint="Ex.: Ponto da carne, Acompanhamentos, Retirar."
      :maxlength="60"
    />
    <div class="grid grid-cols-2 gap-3">
      <AppTextField
        v-model="form.min"
        label="Mínimo de escolhas"
        inputmode="numeric"
        hint="1 ou mais: obrigatório."
      />
      <AppTextField
        v-model="form.max"
        label="Máximo de escolhas"
        inputmode="numeric"
        hint="Pelo menos 1."
      />
    </div>
    <fieldset class="flex flex-col gap-3">
      <legend class="mb-2 font-bold">Opções</legend>
      <div
        v-for="(option, index) in options"
        :key="option.key"
        class="grid grid-cols-[1fr_8rem_auto] items-end gap-2"
      >
        <AppTextField v-model="option.name" :label="`Opção ${index + 1}`" :maxlength="60" />
        <AppTextField v-model="option.price" label="Acréscimo" prefix="R$" inputmode="decimal" />
        <button
          type="button"
          class="flex size-12 items-center justify-center rounded-button text-status-late-text disabled:text-border"
          :aria-label="`Tirar opção ${index + 1}`"
          :disabled="options.length === 1"
          @click="removeOption(option.key)"
        >
          <AppIcon name="trash" />
        </button>
      </div>
      <AppButton variant="ghost" :block="false" class="self-start px-2" @click="addOption">
        <AppIcon name="plus" />
        Mais uma opção
      </AppButton>
    </fieldset>
    <p v-if="error" class="flex items-center gap-1.5 text-sm text-error">
      <AppIcon name="alert-circle" :size="16" />{{ error }}
    </p>
    <ErrorAlert :error="action.error.value" />
    <div class="flex flex-wrap gap-2">
      <AppButton type="submit" variant="secondary" :block="false" :loading="action.busy.value">
        Criar grupo
      </AppButton>
      <AppButton variant="ghost" :block="false" @click="emit('cancel')">Cancelar</AppButton>
    </div>
  </form>
</template>
