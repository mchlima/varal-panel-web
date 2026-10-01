<script setup lang="ts">
import type { components } from '~/api/schema'
import { apiErrorMessage } from '~/lib/api-error'

type OrganizationAccess = components['schemas']['OrganizationAccess']

/**
 * Acesso da equipe (spec 03, seção 6): código do estabelecimento, link `/e/{codigo}` com
 * botão de copiar e QR code grande, para escanear de outro celular.
 */
useHead({ title: 'Acesso da equipe · Varal' })

const { $api } = useNuxtApp()
const access = ref<OrganizationAccess | null>(null)
const loadError = ref('')

async function load() {
  loadError.value = ''
  try {
    const { data, error } = await $api.GET('/api/v1/organization/access')
    if (data) access.value = data
    else loadError.value = apiErrorMessage(error)
  } catch (error) {
    loadError.value = apiErrorMessage(error)
  }
}
onMounted(load)

// O SVG vem da API; como imagem, nenhum script dele roda.
const qrSrc = computed(() =>
  access.value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(access.value.qrSvg)}` : '',
)
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl">Acesso da equipe</h1>
      <p class="text-text-muted">
        A equipe abre o link ou escaneia o QR code e entra só com o usuário e a senha.
      </p>
    </div>

    <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
    <p v-else-if="!access" class="text-text-muted">Carregando…</p>
    <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
          <span class="text-sm text-text-muted">Código da barraca</span>
          <strong
            class="font-display text-2xl tracking-[0.2em] text-text"
            data-testid="access-code"
            >{{ access.accessCode }}</strong
          >
        </div>
        <label class="flex flex-col gap-1.5">
          <span class="font-bold">Link de acesso</span>
          <input
            :value="access.link"
            readonly
            class="min-h-12 w-full rounded-button border-2 border-border-strong bg-surface px-3"
            data-testid="access-link"
            @focus="($event.target as HTMLInputElement).select()"
          />
        </label>
        <CopyButton :text="access.link" variant="primary" />
      </div>
      <figure
        class="flex flex-col items-center gap-2 rounded-card border border-border bg-surface p-4"
      >
        <img
          :src="qrSrc"
          :alt="`QR code do link ${access.link}`"
          class="aspect-square w-full max-w-[min(80vw,360px)]"
          data-testid="access-qr"
        />
        <figcaption class="text-center text-sm text-text-muted">
          Aponte a câmera do outro celular para o QR code.
        </figcaption>
      </figure>
    </div>
  </PanelShell>
</template>
