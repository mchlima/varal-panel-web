<script setup lang="ts">
import { useElementSize } from '@vueuse/core'

/**
 * Faixas fixas no topo de todas as telas: "entrar como" (spec 02, RN-02.19) e conexão
 * (spec 01, seção 11). A altura delas vai para `--top-banners`, para a navegação lateral
 * do painel não ficar por baixo.
 */
const banners = ref<HTMLElement | null>(null)
const { height } = useElementSize(banners, undefined, { box: 'border-box' })
watchEffect(() => {
  if (import.meta.client) {
    document.documentElement.style.setProperty('--top-banners', `${Math.round(height.value)}px`)
  }
})
</script>

<template>
  <div class="min-h-dvh bg-bg">
    <div ref="banners" class="sticky top-0 z-50">
      <ImpersonationBanner />
      <ConnectionBanner />
    </div>
    <PwaUpdateBanner />
    <NuxtPwaManifest />
    <NuxtPage />
  </div>
</template>
