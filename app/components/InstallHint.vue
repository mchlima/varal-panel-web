<script setup lang="ts">
import { readLocal, writeLocal } from '~/lib/browser'

/**
 * Convite para instalar o app (plano 2.3). No Android, o botão usa o
 * `beforeinstallprompt`; no iPhone não existe convite, então mostramos o caminho:
 * Compartilhar → Adicionar à Tela de Início. Instalado, o iOS não apaga os dados.
 */
const IOS_DISMISSED_KEY = 'varal.iosInstallDismissed'

const { $pwa } = useNuxtApp()
const iosDismissed = ref(readLocal(IOS_DISMISSED_KEY) === 'true')

const isIos = computed(() => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return /iPhone|iPad|iPod/.test(ua) || iPadOs
})

const isStandalone = computed(() => {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches
})

const showAndroid = computed(() => Boolean($pwa?.showInstallPrompt) && !isStandalone.value)
const showIos = computed(() => isIos.value && !isStandalone.value && !iosDismissed.value)

async function install() {
  await $pwa?.install()
}

function dismiss() {
  if (showAndroid.value) $pwa?.cancelInstall()
  iosDismissed.value = true
  writeLocal(IOS_DISMISSED_KEY, 'true')
}
</script>

<template>
  <section
    v-if="showAndroid || showIos"
    aria-labelledby="install-title"
    class="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    data-testid="install-hint"
  >
    <h2 id="install-title" class="text-lg text-text">Instale o Varal no celular</h2>
    <p class="text-text-muted">
      Fica na tela inicial, abre mais rápido e guarda as ações quando a internet cai.
    </p>
    <ol v-if="showIos" class="flex flex-col gap-2">
      <li class="flex items-center gap-2">
        <span class="font-bold">1.</span> Toque em
        <span class="inline-flex items-center gap-1 font-bold">
          <AppIcon name="share" :size="18" /> Compartilhar
        </span>
        no Safari.
      </li>
      <li class="flex items-center gap-2">
        <span class="font-bold">2.</span> Escolha
        <span class="inline-flex items-center gap-1 font-bold">
          <AppIcon name="plus-square" :size="18" /> Adicionar à Tela de Início
        </span>
      </li>
    </ol>
    <div class="flex flex-wrap gap-2">
      <AppButton v-if="showAndroid" variant="secondary" :block="false" @click="install">
        <AppIcon name="download" />
        Instalar
      </AppButton>
      <AppButton variant="ghost" :block="false" @click="dismiss">Agora não</AppButton>
    </div>
  </section>
</template>
