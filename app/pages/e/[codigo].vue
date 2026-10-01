<script setup lang="ts">
import { apiErrorCode, apiErrorMessage } from '~/lib/api-error'

/**
 * Link de acesso do colaborador (spec 01, seção 7.1): `/e/{codigo}` abre o login na aba
 * "Sou colaborador", com o código preenchido e o nome da barraca no topo (CA-01.03).
 */
const route = useRoute()
const { $api } = useNuxtApp()

const code = computed(() =>
  String(route.params.codigo ?? '')
    .trim()
    .toUpperCase(),
)
const organizationName = ref<string | null>(null)
const loadError = ref('')
const invalid = ref(false)
const loading = ref(true)

useHead({
  title: () => (organizationName.value ? `${organizationName.value} · Varal` : 'Entrar · Varal'),
})

async function load() {
  loading.value = true
  loadError.value = ''
  invalid.value = false
  try {
    const { data, error } = await $api.GET('/api/v1/auth/access-code/{code}', {
      params: { path: { code: code.value } },
    })
    if (data) {
      organizationName.value = data.organizationName
    } else if (apiErrorCode(error) === 'NOT_FOUND') {
      invalid.value = true
    } else {
      loadError.value = apiErrorMessage(error)
    }
  } catch (error) {
    loadError.value = apiErrorMessage(error)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <AuthShell
    :title="organizationName ?? 'Entrar'"
    :subtitle="organizationName ? 'Acesso da equipe' : undefined"
  >
    <p v-if="loading" role="status" class="text-text-muted">Carregando a barraca…</p>

    <template v-else-if="invalid">
      <AppAlert tone="error">
        <p class="font-bold">Código de acesso inválido.</p>
        <p>
          O código <strong>{{ code }}</strong> não é de nenhuma barraca. Confira o link ou o QR code
          com o responsável.
        </p>
      </AppAlert>
      <AppButton to="/entrar?aba=colaborador">Digitar o código</AppButton>
    </template>

    <template v-else>
      <AppAlert v-if="loadError" tone="error">
        {{ loadError }}
        <button
          type="button"
          class="mt-1 block min-h-12 font-bold underline underline-offset-4"
          @click="load"
        >
          Tentar de novo
        </button>
      </AppAlert>
      <LoginForm initial-tab="staff" :access-code="code" lock-access-code />
    </template>
  </AuthShell>
</template>
