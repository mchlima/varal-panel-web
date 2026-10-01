<script setup lang="ts">
import type { components } from '~/api/schema'
import { apiErrorMessage } from '~/lib/api-error'
import { LATE_AFTER_MAX, LATE_AFTER_MIN, isNewer, parseInteger } from '~/lib/setup'

type Unit = components['schemas']['Unit']

/** Unidades (spec 03, seção 3 e tela "Unidades" da seção 9). */
useHead({ title: 'Unidades · Varal' })

const { $api } = useNuxtApp()
const session = useSessionStore()
const units = ref<Unit[]>([])
const loading = ref(true)
const loadError = ref('')

/**
 * O OpenAPI ainda não publica `limit`/`cursor` de `GET /units` (a API pagina com 50 por
 * padrão): a tela mostra a primeira página e avisa se houver mais.
 */
const hasMore = ref(false)

async function load() {
  loadError.value = ''
  try {
    const { data, error } = await $api.GET('/api/v1/units')
    if (!data) {
      loadError.value = apiErrorMessage(error)
      return
    }
    units.value = data.data
    hasMore.value = data.nextCursor !== null
  } catch (error) {
    loadError.value = apiErrorMessage(error)
  } finally {
    loading.value = false
  }
}

/** Mudou a unidade: recarrega a lista e o `/auth/me` (unidades das outras telas). */
async function refresh() {
  await Promise.all([load(), session.restore()])
}

onMounted(load)
useRealtimeResync(load)
useRealtimeEvent('unit.config_updated', (event) => {
  const unit = units.value.find((item) => item.id === event.data.unitId)
  if (!unit || isNewer(event.version, unit.version)) void load()
})

// Nova unidade
const creating = ref(false)
const action = useApiAction()
const idempotency = useIdempotencyKey()
const form = reactive({ name: '', late: '15' })
const errors = ref<{ name?: string; late?: string }>({})

function openCreate() {
  form.name = ''
  form.late = '15'
  errors.value = {}
  action.clear()
  creating.value = true
}

async function create() {
  const late = parseInteger(form.late)
  errors.value = {}
  if (!form.name.trim()) errors.value.name = 'Informe o nome da unidade.'
  if (late === null || late < LATE_AFTER_MIN || late > LATE_AFTER_MAX) {
    errors.value.late = `Use um número de ${LATE_AFTER_MIN} a ${LATE_AFTER_MAX}.`
  }
  if (Object.keys(errors.value).length || late === null) return
  const body = { name: form.name.trim(), lateAfterMinutes: late }
  const result = await action.run(() =>
    $api.POST('/api/v1/units', {
      params: { header: { 'Idempotency-Key': idempotency.keyFor(body) } },
      body,
    }),
  )
  if (result.ok) {
    idempotency.reset()
    creating.value = false
    await refresh()
  }
}
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl">Unidades</h1>
      <p class="text-text-muted">
        Cada barraca é uma unidade, com estações, fluxo de etapas e cardápio próprios.
      </p>
    </div>

    <AppButton v-if="!creating" @click="openCreate">
      <AppIcon name="plus" />
      Nova unidade
    </AppButton>
    <form
      v-else
      class="flex flex-col gap-3 rounded-card border-2 border-primary bg-surface p-4"
      novalidate
      aria-labelledby="new-unit-title"
      @submit.prevent="create"
    >
      <h2 id="new-unit-title" class="text-xl">Nova unidade</h2>
      <p class="text-sm text-text-muted">
        Ela já nasce com as estações Balcão, Cozinha e Balcão de entrega e o fluxo Recebido →
        Preparando → Pronto → Entregue (dá para mudar depois). O cardápio começa vazio.
      </p>
      <AppTextField
        v-model="form.name"
        label="Nome da unidade"
        :error="errors.name"
        :maxlength="80"
      />
      <AppTextField
        v-model="form.late"
        label="Tempo de atraso (minutos)"
        inputmode="numeric"
        :hint="`Depois desse tempo, o item aparece como atrasado na estação (${LATE_AFTER_MIN} a ${LATE_AFTER_MAX}).`"
        :error="errors.late"
      />
      <ErrorAlert :error="action.error.value" />
      <AppButton type="submit" :loading="action.busy.value">Criar unidade</AppButton>
      <AppButton variant="ghost" @click="creating = false">Cancelar</AppButton>
    </form>

    <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
    <p v-else-if="loading" class="text-text-muted">Carregando unidades…</p>
    <div v-else class="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <UnitCard v-for="unit in units" :key="unit.id" :unit="unit" @changed="refresh" />
    </div>
    <AppAlert v-if="hasMore">Mostrando as primeiras 50 unidades.</AppAlert>
  </PanelShell>
</template>
