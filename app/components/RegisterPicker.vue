<script setup lang="ts">
import type { CashRegister } from '~/lib/payment'

/**
 * Caixa que recebe (RN-05.05, RN-05.06, CA-05.08): sem caixa aberto, orienta ("Abra um caixa
 * para receber"); com um, nada a escolher; com mais de um, a escolha (lembrada no aparelho).
 */
withDefaults(
  defineProps<{
    registers: readonly CashRegister[]
    selectedId: string | null
    loaded: boolean
    /** Dono ou quem opera caixa (RN-05.16): mostra o atalho para abrir um caixa. */
    canOpen?: boolean
    unitId?: string | null
  }>(),
  { canOpen: false, unitId: null },
)
const emit = defineEmits<{ choose: [id: string] }>()
</script>

<template>
  <AppAlert v-if="loaded && registers.length === 0" tone="error">
    <div data-testid="no-register">
      <p class="font-bold">Abra um caixa para receber.</p>
      <p v-if="canOpen">
        <NuxtLink
          :to="unitId ? `/caixas?unidade=${unitId}` : '/caixas'"
          class="inline-flex min-h-12 items-center font-bold underline"
          >Abrir caixa</NuxtLink
        >
      </p>
      <p v-else>Peça a quem opera o caixa para abrir um.</p>
    </div>
  </AppAlert>
  <fieldset v-else-if="registers.length > 1" class="flex flex-col gap-2">
    <legend class="mb-2 font-bold">Caixa que recebe</legend>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="register in registers"
        :key="register.id"
        type="button"
        :aria-pressed="register.id === selectedId"
        class="min-h-12 rounded-button border-2 px-4 font-bold"
        :class="
          register.id === selectedId
            ? 'border-primary bg-primary-soft text-primary-deep'
            : 'border-border-strong bg-surface'
        "
        data-testid="register-option"
        @click="emit('choose', register.id)"
      >
        {{ register.name }}
      </button>
    </div>
    <p v-if="!selectedId" class="text-sm font-bold text-error">Escolha o caixa antes de receber.</p>
  </fieldset>
</template>
