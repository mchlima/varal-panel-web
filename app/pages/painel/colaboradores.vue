<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
import { permissionSummary, type StaffMember } from '~/lib/staff'

/** Colaboradores e permissões (spec 03, seção 6 e tela "Colaboradores" da seção 9). */
useHead({ title: 'Colaboradores · Varal' })

const { $api } = useNuxtApp()
const members = ref<StaffMember[]>([])
const loading = ref(true)
const loadError = ref('')
/** O OpenAPI ainda não publica `limit`/`cursor` de `GET /staff`: primeira página (50). */
const hasMore = ref(false)

async function load() {
  loadError.value = ''
  try {
    const { data, error } = await $api.GET('/api/v1/staff')
    if (!data) {
      loadError.value = apiErrorMessage(error)
      return
    }
    members.value = data.data
    hasMore.value = data.nextCursor !== null
  } catch (error) {
    loadError.value = apiErrorMessage(error)
  } finally {
    loading.value = false
  }
}

onMounted(load)
useRealtimeResync(load)
// Estações renomeadas ou desativadas mudam o resumo das permissões.
useRealtimeEvent('unit.config_updated', () => void load())

const creating = ref(false)
const selectedId = ref<string | null>(null)
const selected = computed(() => members.value.find((m) => m.id === selectedId.value) ?? null)
const editorOpen = computed({
  get: () => selected.value !== null,
  set: (open: boolean) => {
    if (!open) selectedId.value = null
  },
})

async function created() {
  creating.value = false
  await load()
}
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl">Colaboradores</h1>
      <p class="text-text-muted">
        Cada pessoa da equipe entra com o código da barraca, o usuário e a senha, e só abre as
        estações liberadas para ela.
      </p>
    </div>

    <AppButton @click="creating = true">
      <AppIcon name="plus" />
      Novo colaborador
    </AppButton>

    <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
    <p v-else-if="loading" class="text-text-muted">Carregando equipe…</p>
    <AppAlert v-else-if="members.length === 0">Nenhum colaborador cadastrado ainda.</AppAlert>
    <ul v-else class="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <li v-for="member in members" :key="member.id">
        <button
          type="button"
          class="flex w-full flex-col gap-2 rounded-card border border-border bg-surface p-4 text-left hover:border-primary"
          :aria-label="`Gerenciar ${member.name}`"
          data-testid="staff-card"
          @click="selectedId = member.id"
        >
          <span class="flex w-full flex-wrap items-center gap-2">
            <span class="min-w-0 flex-1">
              <span class="block font-display text-lg font-semibold">{{ member.name }}</span>
              <span class="block text-sm text-text-muted">usuário {{ member.username }}</span>
            </span>
            <StatusChip
              :tone="member.active ? 'active' : 'inactive'"
              :label="member.active ? 'Ativo' : 'Desativado'"
            />
          </span>
          <span v-if="!member.hasPassword" class="text-sm">
            <StatusChip tone="info" label="Sem senha" />
          </span>
          <span v-if="member.permissions.length === 0" class="text-sm text-text-muted">
            Nenhuma unidade liberada: não consegue entrar.
          </span>
          <span
            v-for="permission in member.permissions"
            :key="permission.unitId"
            class="text-sm text-text"
          >
            {{ permissionSummary(permission) }}
          </span>
        </button>
      </li>
    </ul>
    <AppAlert v-if="hasMore">Mostrando os primeiros 50 colaboradores.</AppAlert>

    <AppDialog v-model:open="creating" title="Novo colaborador">
      <StaffCreateForm v-if="creating" @saved="created" @cancel="creating = false" />
    </AppDialog>

    <AppDialog v-model:open="editorOpen" :title="selected?.name ?? 'Colaborador'">
      <StaffEditor v-if="selected" :key="selected.id" :member="selected" @changed="load" />
    </AppDialog>
  </PanelShell>
</template>
