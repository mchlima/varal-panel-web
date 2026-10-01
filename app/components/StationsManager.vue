<script setup lang="ts">
import type { components } from '~/api/schema'
import { STATION_KIND_LABELS, type StationKind } from '~/lib/setup'

type Station = components['schemas']['Station']

/**
 * Estações da unidade (spec 03, seção 4.1): criar, renomear, tipo, ordem, ativar e desativar.
 * Nunca são apagadas. Em uso pelo fluxo, por categoria ou por produto, não podem ser
 * desativadas nem virar balcão (`STATION_IN_USE`); RN-03.04 exige um balcão e uma fila ativos.
 */
const props = defineProps<{ unitId: string; stations: Station[] }>()
const emit = defineEmits<{ changed: [] }>()

const { $api } = useNuxtApp()
const action = useApiAction()
const idempotency = useIdempotencyKey()
const editingId = ref<string | null>(null)
const creating = ref(false)
const form = reactive<{ name: string; kind: StationKind }>({ name: '', kind: 'queue' })
const nameError = ref('')

const kindOptions = (Object.keys(STATION_KIND_LABELS) as StationKind[]).map((kind) => ({
  value: kind,
  label: STATION_KIND_LABELS[kind],
}))

function startEdit(station: Station) {
  creating.value = false
  editingId.value = station.id
  form.name = station.name
  form.kind = station.kind
  nameError.value = ''
  action.clear()
}

function startCreate() {
  editingId.value = null
  creating.value = true
  form.name = ''
  form.kind = 'queue'
  nameError.value = ''
  action.clear()
}

function cancel() {
  editingId.value = null
  creating.value = false
}

async function update(station: Station, body: components['schemas']['UpdateStationRequestInput']) {
  const result = await action.run(() =>
    $api.PATCH('/api/v1/stations/{id}', { params: { path: { id: station.id } }, body }),
  )
  if (result.ok) {
    editingId.value = null
    emit('changed')
  }
  return result.ok
}

async function submit() {
  nameError.value = form.name.trim() ? '' : 'Informe o nome da estação.'
  if (nameError.value) return
  const station = props.stations.find((item) => item.id === editingId.value)
  if (station) {
    await update(station, { name: form.name.trim(), kind: form.kind })
    return
  }
  const body = { name: form.name.trim(), kind: form.kind }
  const result = await action.run(() =>
    $api.POST('/api/v1/units/{id}/stations', {
      params: {
        path: { id: props.unitId },
        header: { 'Idempotency-Key': idempotency.keyFor(body) },
      },
      body,
    }),
  )
  if (result.ok) {
    idempotency.reset()
    creating.value = false
    emit('changed')
  }
}

/** Nova ordem: grava a posição (1 é a primeira) das estações que mudaram de lugar. */
async function reorder(ids: string[]) {
  for (const [index, id] of ids.entries()) {
    const station = props.stations.find((item) => item.id === id)
    if (!station || station.sortOrder === index + 1) continue
    const result = await action.run(() =>
      $api.PATCH('/api/v1/stations/{id}', {
        params: { path: { id } },
        body: { sortOrder: index + 1 },
      }),
    )
    if (!result.ok) break
  }
  emit('changed')
}
</script>

<template>
  <section aria-labelledby="stations-title" class="flex flex-col gap-3">
    <div class="flex flex-col gap-1">
      <h2 id="stations-title" class="text-xl">Estações</h2>
      <p class="text-text-muted">
        Cada estação é uma tela aberta num celular. Balcão de pedidos abre comandas e lança pedidos;
        fila mostra os itens das etapas ligadas a ela.
      </p>
    </div>

    <ErrorAlert :error="action.error.value" @reload="emit('changed')" />

    <SortableList
      :items="stations"
      :item-label="(station) => station.name"
      noun="estação"
      :disabled="action.busy.value"
      @reorder="reorder"
    >
      <template #default="{ item: station }">
        <form
          v-if="editingId === station.id"
          class="flex flex-col gap-3 pr-1"
          novalidate
          @submit.prevent="submit"
        >
          <AppTextField
            v-model="form.name"
            label="Nome da estação"
            :error="nameError"
            :maxlength="60"
          />
          <AppSelect v-model="form.kind" label="Tipo" :options="kindOptions" />
          <div class="flex flex-wrap gap-2">
            <AppButton
              type="submit"
              variant="secondary"
              :block="false"
              :loading="action.busy.value"
            >
              Salvar
            </AppButton>
            <AppButton variant="ghost" :block="false" @click="cancel">Cancelar</AppButton>
          </div>
        </form>
        <div v-else class="flex flex-col gap-1" data-testid="station-row">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-bold">{{ station.name }}</span>
            <StatusChip v-if="!station.active" tone="inactive" label="Desativada" />
          </div>
          <span class="text-sm text-text-muted">{{ STATION_KIND_LABELS[station.kind] }}</span>
          <div class="flex flex-wrap items-center gap-1">
            <AppButton variant="ghost" :block="false" class="px-2" @click="startEdit(station)">
              <AppIcon name="edit" />
              Editar
            </AppButton>
            <ConfirmAction
              v-if="station.active"
              label="Desativar"
              :question="`Desativar ${station.name}?`"
              confirm-label="Desativar estação"
              :loading="action.busy.value"
              @confirm="update(station, { active: false })"
            >
              <template #icon><AppIcon name="power" /></template>
              <p>Ninguém mais abre esta estação até ela ser ativada de novo.</p>
            </ConfirmAction>
            <AppButton
              v-else
              variant="ghost"
              :block="false"
              class="px-2"
              @click="update(station, { active: true })"
            >
              <AppIcon name="power" />
              Ativar
            </AppButton>
          </div>
        </div>
      </template>
    </SortableList>

    <form
      v-if="creating"
      class="flex flex-col gap-3 rounded-card border-2 border-primary bg-surface p-4"
      novalidate
      aria-label="Nova estação"
      @submit.prevent="submit"
    >
      <AppTextField
        v-model="form.name"
        label="Nome da estação"
        :error="nameError"
        :maxlength="60"
      />
      <AppSelect v-model="form.kind" label="Tipo" :options="kindOptions" />
      <div class="flex flex-wrap gap-2">
        <AppButton type="submit" variant="secondary" :block="false" :loading="action.busy.value">
          Criar estação
        </AppButton>
        <AppButton variant="ghost" :block="false" @click="cancel">Cancelar</AppButton>
      </div>
    </form>
    <AppButton v-else variant="secondary" @click="startCreate">
      <AppIcon name="plus" />
      Nova estação
    </AppButton>
  </section>
</template>
