<script setup lang="ts">
/** Moldura das telas de acesso: logo no topo e um cartão numa coluna (celular primeiro). */
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-8">
    <NuxtLink to="/entrar" class="self-start rounded-button" aria-label="Varal, ir para o login">
      <img src="/logo.svg" alt="Varal" width="142" height="48" class="h-12 w-auto" />
    </NuxtLink>
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl text-text">{{ title }}</h1>
      <p v-if="subtitle" class="text-text-muted">{{ subtitle }}</p>
    </div>
    <slot />
  </main>
</template>
