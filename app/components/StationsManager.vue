<script setup lang="ts">
import type { components } from '~/api/schema'
import { STATION_KIND_LABELS, parseInteger, type StationKind } from '~/lib/setup'
import { timeLimitsError } from '~/lib/station'

type Station = components['schemas']['Station']

/**
 * Estações da unidade (spec 03, seção 4.1): criar, renomear, tipo, ordem, ativar e desativar.
 * Nunca são apagadas. Em uso pelo fluxo, por categoria ou por produto, não podem ser
 * desativadas nem virar balcão (`STATION_IN_USE`); RN-03.04 exige um balcão e uma fila ativos.
 * RN-03.25: cada fila tem o limite de atenção e o de atraso, contados desde o envio do pedido;
 * mudar vale na hora para os cartões na tela, mesmo com caixa aberto.
 */
const props = defineProps<{ unitId: string; stations: Station[] }>()
const emit = defineEmits<{ changed: [] }>()

const { $api } = useNuxtApp()
const action = useApiAction()
const idempotency = useIdempotencyKey()
const editingId = ref<string | null>(null)
const creating = ref(false)
const form = reactive<{ name: string; kind: StationKind; attention: string; late: string }>({
  name: '',
  kind: 'queue',
  attention: '',
  late: '',
})
const nameError = ref('')
const limitsError = ref('')

const kindOptions = (Object.keys(STATION_KIND_LABELS) as StationKind[]).map((kind) => ({
  value: kind,
  label: STATION_KIND_LABELS[kind],
}))

function startEdit(station: Station) {
  creating.value = false
  editingId.value = station.id
  form.name = station.name
  form.kind = station.kind
  form.attention = station.attentionAfterMinutes?.toString() ?? ''
  form.late = station.lateAfterMinutes?.toString() ?? ''
  nameError.value = ''
  limitsError.value = ''
  action.clear()
}

function startCreate() {
  editingId.value = null
  creating.value = true
  form.name = ''
  form.kind = 'queue'
  form.attention = ''
  form.late = ''
  nameError.value = ''
  limitsError.value = ''
  action.clear()
}

/**
 * Limites digitados (RN-03.25). Vazios na estação nova: a API usa o atraso padrão da unidade e a
 * atenção na metade. `null` quando há erro (mensagem em `limitsError`).
 */
function readLimits(): { attentionAfterMinutes?: number; lateAfterMinutes?: number } | null {
  limitsError.value = ''
  if (form.kind !== 'queue') return {}
  const hasAttention = form.attention.trim() !== ''
  const hasLate = form.late.trim() !== ''
  if (!hasAttention && !hasLate) return {}
  const attention = parseInteger(form.attention)
  const late = parseInteger(form.late)
  if (attention === null || late === null) {
    limitsError.value = 'Preencha os dois tempos em minutos inteiros.'
    return null
  }
  const error = timeLimitsError(attention, late)
  if (error) {
    limitsError.value = error
    return null
  }
  return { attentionAfterMinutes: attention, lateAfterMinutes: late }
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
  const limits = readLimits()
  if (nameError.value || !limits) return
  const station = props.stations.find((item) => item.id === editingId.value)
  if (station) {
    // Só o que mudou: os limites mudam mesmo com caixa aberto; nome e tipo, não (RN-03.07).
    const body: components['schemas']['UpdateStationRequestInput'] = {}
    if (form.name.trim() !== station.name) body.name = form.name.trim()
    if (form.kind !== station.kind) body.kind = form.kind
    if (limits.attentionAfterMinutes !== undefined) {
      if (limits.attentionAfterMinutes !== station.attentionAfterMinutes) {
        body.attentionAfterMinutes = limits.attentionAfterMinutes
      }
      if (limits.lateAfterMinutes !== station.lateAfterMinutes) {
        body.lateAfterMinutes = limits.lateAfterMinutes
      }
    }
    if (Object.keys(body).length === 0) {
      editingId.value = null
      return
    }
    await update(station, body)
    return
  }
  const body = { name: form.name.trim(), kind: form.kind, ...limits }
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
          <fieldset v-if="form.kind === 'queue'" class="flex flex-col gap-2">
            <legend class="mb-1 font-bold">Tempo dos pedidos (minutos desde o envio)</legend>
            <div class="grid grid-cols-2 gap-3">
              <AppTextField
                v-model="form.attention"
                label="Atenção a partir de"
                inputmode="numeric"
                hint="Cartão fica laranja"
              />
              <AppTextField
                v-model="form.late"
                label="Atrasado a partir de"
                inputmode="numeric"
                hint="Cartão fica vermelho"
              />
            </div>
            <p v-if="limitsError" class="font-bold text-error" role="alert">{{ limitsError }}</p>
          </fieldset>
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
          <span
            v-if="station.kind === 'queue' && station.lateAfterMinutes !== null"
            class="flex flex-wrap items-center gap-1.5 text-sm"
            data-testid="station-limits"
          >
            <StageChip
              status="attention"
              :label="`Atenção: ${station.attentionAfterMinutes} min`"
            />
            <StageChip status="late" :label="`Atrasado: ${station.lateAfterMinutes} min`" />
          </span>
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
      <fieldset v-if="form.kind === 'queue'" class="flex flex-col gap-2">
        <legend class="mb-1 font-bold">Tempo dos pedidos (minutos desde o envio)</legend>
        <div class="grid grid-cols-2 gap-3">
          <AppTextField
            v-model="form.attention"
            label="Atenção a partir de"
            inputmode="numeric"
            hint="Cartão fica laranja"
          />
          <AppTextField
            v-model="form.late"
            label="Atrasado a partir de"
            inputmode="numeric"
            hint="Cartão fica vermelho"
          />
        </div>
        <p v-if="limitsError" class="font-bold text-error" role="alert">{{ limitsError }}</p>
      </fieldset>
      <p v-if="form.kind === 'queue'" class="text-sm text-text-muted">
        Deixe os tempos vazios para usar o padrão da unidade.
      </p>
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
