<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

/**
 * Botões da spec 08 (seção 6):
 * - `primary`: a única ação principal da tela; fundo Framboesa, 52 px, largura total.
 * - `secondary`: contorno de 2 px na primária, texto `primary-deep`.
 * - `ghost`: só texto, para ações de menor peso (sempre com 48 px de alvo).
 */
const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost'
    type?: 'button' | 'submit'
    to?: RouteLocationRaw
    loading?: boolean
    disabled?: boolean
    block?: boolean
  }>(),
  {
    variant: 'primary',
    type: 'button',
    to: undefined,
    loading: false,
    disabled: false,
    block: true,
  },
)

const classes = computed(() => [
  'inline-flex items-center justify-center gap-2 rounded-button px-5 text-base font-bold',
  'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
  props.block ? 'w-full' : '',
  {
    primary: 'min-h-13 bg-primary text-primary-ink hover:bg-primary-deep',
    secondary:
      'min-h-12 border-2 border-primary bg-surface text-primary-deep hover:bg-primary-soft',
    ghost: 'min-h-12 text-primary-deep underline-offset-4 hover:underline',
  }[props.variant],
])
</script>

<template>
  <NuxtLink v-if="to" :to="to" :class="classes">
    <slot />
  </NuxtLink>
  <button
    v-else
    :type="type"
    :class="classes"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <AppIcon v-if="loading" name="refresh" class="animate-spin" />
    <slot />
  </button>
</template>
