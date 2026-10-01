<script setup lang="ts">
import type { MenuCategory } from '~/stores/menu'

/**
 * Categoria (spec 03, seção 5.1): nome único na unidade, estação de preparo padrão
 * (estação de fila ativa, RN-03.08) e ativa. Sem estação escolhida, a API usa a Cozinha.
 */
const props = defineProps<{ unitId: string; category: MenuCategory | null }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()

const { $api } = useNuxtApp()
const menu = useMenuStore()
const action = useApiAction()
const idempotency = useIdempotencyKey()
const form = reactive({
  name: props.category?.name ?? '',
  stationId: props.category?.defaultStationId ?? menu.queueStations[0]?.id ?? '',
  active: props.category?.active ?? true,
})
const nameError = ref('')

const stationOptions = computed(() => {
  const options = menu.queueStations.map((station) => ({ value: station.id, label: station.name }))
  if (form.stationId && !options.some((option) => option.value === form.stationId)) {
    options.push({ value: form.stationId, label: `${menu.stationName(form.stationId)} (inativa)` })
  }
  return options
})

async function save() {
  nameError.value = form.name.trim() ? '' : 'Informe o nome da categoria.'
  if (nameError.value) return
  const base = {
    name: form.name.trim(),
    active: form.active,
    ...(form.stationId ? { defaultStationId: form.stationId } : {}),
  }
  const category = props.category
  const result = category
    ? await action.run(() =>
        $api.PATCH('/api/v1/categories/{id}', {
          params: { path: { id: category.id } },
          body: base,
        }),
      )
    : await action.run(() => {
        const body = { ...base, unitId: props.unitId }
        return $api.POST('/api/v1/categories', {
          params: { header: { 'Idempotency-Key': idempotency.keyFor(body) } },
          body,
        })
      })
  if (result.ok) {
    idempotency.reset()
    emit('saved')
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="save">
    <AppTextField
      v-model="form.name"
      label="Nome da categoria"
      :error="nameError"
      :maxlength="60"
    />
    <AppSelect
      v-model="form.stationId"
      label="Estação de preparo padrão"
      hint="Onde os produtos desta categoria são preparados, se o produto não tiver uma estação própria."
      :options="stationOptions"
    />
    <AppCheckbox
      v-model="form.active"
      label="Ativa"
      description="Categoria desativada some do balcão com todos os produtos dela."
    />
    <ErrorAlert :error="action.error.value" />
    <AppButton type="submit" :loading="action.busy.value">
      {{ category ? 'Salvar categoria' : 'Criar categoria' }}
    </AppButton>
    <AppButton variant="ghost" @click="emit('cancel')">Cancelar</AppButton>
  </form>
</template>
