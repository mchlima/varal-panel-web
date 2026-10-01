<script setup lang="ts">
/**
 * Moldura provisória do balcão e das estações até a spec 04: cabeçalho, nome da estação,
 * aviso honesto do que ainda falta e o atalho de esgotado (spec 03, seção 9).
 */
defineProps<{ title: string; unitName?: string }>()
</script>

<template>
  <div class="min-h-dvh bg-bg">
    <AppHeader />
    <main class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div class="flex flex-col gap-1">
        <p v-if="unitName" class="text-text-muted">{{ unitName }}</p>
        <h1 class="text-2xl">{{ title }}</h1>
      </div>
      <slot />
      <AppButton variant="ghost" :block="false" to="/estacoes" class="self-start">
        <AppIcon name="arrow-left" />
        Trocar de estação
      </AppButton>
    </main>
  </div>
</template>
