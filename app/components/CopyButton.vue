<script setup lang="ts">
/** Copia um texto (link de acesso, link de redefinição) e confirma com texto e ícone. */
const props = withDefaults(
  defineProps<{ text: string; label?: string; variant?: 'primary' | 'secondary' }>(),
  { label: 'Copiar link', variant: 'secondary' },
)
const state = ref<'idle' | 'copied' | 'failed'>('idle')
let timer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  try {
    await navigator.clipboard.writeText(props.text)
    state.value = 'copied'
  } catch {
    state.value = 'failed'
  }
  clearTimeout(timer)
  timer = setTimeout(() => (state.value = 'idle'), 3000)
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="flex flex-col gap-1">
    <AppButton :variant="variant" @click="copy">
      <AppIcon :name="state === 'copied' ? 'check' : 'copy'" />
      {{ state === 'copied' ? 'Copiado' : label }}
    </AppButton>
    <p aria-live="polite" class="text-sm" :class="state === 'failed' ? 'text-error' : 'sr-only'">
      <template v-if="state === 'copied'">Link copiado.</template>
      <template v-else-if="state === 'failed'">
        Não deu para copiar. Toque e segure o link acima para copiar.
      </template>
    </p>
  </div>
</template>
