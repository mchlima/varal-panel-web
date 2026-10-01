<script setup lang="ts">
import type { components } from '~/api/schema'
import { moveItem } from '~/lib/list'
import { uuidv7 } from '~/lib/uuid'
import {
  MAX_STAGES,
  MIN_STAGES,
  TARGET_LABELS,
  validateWorkflow,
  workflowIssuesFrom,
  type StageDraft,
  type WorkflowIssue,
  type WorkflowStageTarget,
} from '~/lib/workflow'

type Workflow = components['schemas']['Workflow']
type Station = components['schemas']['Station']

/**
 * Editor do fluxo de etapas (spec 03, seção 4.2): etapas em ordem, destino de cada uma e
 * etapa final. Salvo inteiro de uma vez com a `version` da unidade. A validação local segue
 * as RN-03.05 e RN-03.06; o que a API recusar em `INVALID_WORKFLOW` aparece do mesmo jeito.
 * Etapas retiradas são arquivadas pela API (itens antigos apontam para elas).
 */
const props = defineProps<{ unitId: string; workflow: Workflow; stations: Station[] }>()
const emit = defineEmits<{ saved: []; reload: [] }>()

const { $api } = useNuxtApp()
const action = useApiAction()

function toDrafts(workflow: Workflow): StageDraft[] {
  return workflow.stages.map((stage) => ({
    key: stage.id,
    id: stage.id,
    name: stage.name,
    target: stage.target,
    stationId: stage.stationId,
  }))
}

const stages = ref<StageDraft[]>(toDrafts(props.workflow))
const baseVersion = ref(props.workflow.version)
const baseline = ref(JSON.stringify(toDrafts(props.workflow)))
const serverIssues = ref<WorkflowIssue[]>([])
const showIssues = ref(false)
/** O fluxo mudou em outro aparelho enquanto havia alterações aqui. */
const changedElsewhere = ref(false)

const dirty = computed(() => JSON.stringify(stages.value) !== baseline.value)

/**
 * Chegou uma versão nova do fluxo (salvo aqui, evento ou mudança de estação). Sem
 * alterações locais, troca tudo. Com alterações: se as etapas do servidor são as mesmas de
 * antes (só a versão da unidade subiu, ex.: estação renomeada), só atualiza a versão;
 * senão avisa que outro aparelho mexeu no fluxo.
 */
watch(
  () => props.workflow,
  (workflow) => {
    const incoming = JSON.stringify(toDrafts(workflow))
    if (!dirty.value) {
      stages.value = toDrafts(workflow)
      baseline.value = incoming
      baseVersion.value = workflow.version
      changedElsewhere.value = false
      serverIssues.value = []
    } else if (incoming === baseline.value) {
      baseVersion.value = workflow.version
    } else {
      changedElsewhere.value = true
    }
  },
)

const queueStations = computed(() =>
  props.stations.filter((station) => station.kind === 'queue' && station.active),
)

const targetOptions = (Object.keys(TARGET_LABELS) as WorkflowStageTarget[]).map((target) => ({
  value: target,
  label: TARGET_LABELS[target],
}))

function stationOptions(stage: StageDraft) {
  const options = [
    { value: '', label: 'Escolha a estação' },
    ...queueStations.value.map((station) => ({ value: station.id, label: station.name })),
  ]
  const current = props.stations.find((station) => station.id === stage.stationId)
  if (current && !queueStations.value.includes(current)) {
    options.push({ value: current.id, label: `${current.name} (não é fila ativa)` })
  }
  return options
}

const localIssues = computed(() => validateWorkflow(stages.value, props.stations))
const emptyNames = computed(() =>
  stages.value.flatMap((stage, index) => (stage.name.trim() ? [] : [index])),
)
const issues = computed(() => (serverIssues.value.length ? serverIssues.value : localIssues.value))
const generalIssues = computed(() => issues.value.filter((issue) => issue.index === null))

function stageIssues(index: number): string[] {
  const messages = issues.value
    .filter((issue) => issue.index === index)
    .map((issue) => issue.message)
  if (showIssues.value && emptyNames.value.includes(index)) messages.unshift('Dê um nome à etapa.')
  return messages
}

function edited() {
  serverIssues.value = []
}

function setTarget(stage: StageDraft, target: string) {
  stage.target = target as WorkflowStageTarget
  if (stage.target !== 'fixed_station') stage.stationId = null
  edited()
}

function setStation(stage: StageDraft, id: string) {
  stage.stationId = id || null
  edited()
}

function move(index: number, delta: number) {
  stages.value = moveItem(stages.value, index, index + delta)
  edited()
}

function remove(index: number) {
  stages.value = stages.value.filter((_, i) => i !== index)
  edited()
}

/** Etapa nova entra antes da final (o item ainda está numa fila). */
function add() {
  const draft: StageDraft = { key: uuidv7(), name: '', target: 'product_station', stationId: null }
  const last = stages.value.at(-1)
  const at = last?.target === 'none' ? stages.value.length - 1 : stages.value.length
  const next = [...stages.value]
  next.splice(at, 0, draft)
  stages.value = next
  edited()
}

function discard() {
  emit('reload')
  stages.value = toDrafts(props.workflow)
  baseline.value = JSON.stringify(stages.value)
  baseVersion.value = props.workflow.version
  serverIssues.value = []
  showIssues.value = false
  changedElsewhere.value = false
  action.clear()
}

async function save() {
  showIssues.value = true
  if (localIssues.value.length || emptyNames.value.length) return
  const result = await action.run(() =>
    $api.PUT('/api/v1/units/{id}/workflow', {
      params: { path: { id: props.unitId } },
      body: {
        version: baseVersion.value,
        stages: stages.value.map((stage) => ({
          ...(stage.id ? { id: stage.id } : {}),
          name: stage.name.trim(),
          target: stage.target,
          stationId: stage.target === 'fixed_station' ? stage.stationId : null,
        })),
      },
    }),
  )
  if (result.ok && result.data) {
    stages.value = toDrafts(result.data)
    baseline.value = JSON.stringify(stages.value)
    baseVersion.value = result.data.version
    showIssues.value = false
    emit('saved')
  } else if (action.error.value?.code === 'INVALID_WORKFLOW') {
    serverIssues.value = workflowIssuesFrom(action.error.value.details)
  }
}
</script>

<template>
  <section aria-labelledby="workflow-title" class="flex flex-col gap-3">
    <div class="flex flex-col gap-1">
      <h2 id="workflow-title" class="text-xl">Fluxo de etapas</h2>
      <p class="text-text-muted">
        Todo item passa por estas etapas, do pedido à entrega. Cada etapa diz em qual estação o item
        aparece. A última é a etapa final: o item sai de todas as filas. De {{ MIN_STAGES }} a
        {{ MAX_STAGES }} etapas.
      </p>
    </div>

    <AppAlert v-if="changedElsewhere">
      <p class="font-bold">O fluxo foi alterado em outro aparelho.</p>
      <p>Descarte suas alterações para ver a versão atual.</p>
    </AppAlert>

    <ol class="flex flex-col gap-3" data-testid="workflow-stages">
      <li
        v-for="(stage, index) in stages"
        :key="stage.key"
        class="flex flex-col gap-3 rounded-card border bg-surface p-4"
        :class="stageIssues(index).length ? 'border-error' : 'border-border'"
        :aria-label="`Etapa ${index + 1}`"
      >
        <div class="flex items-center gap-2">
          <span class="font-display text-lg font-semibold">Etapa {{ index + 1 }}</span>
          <StatusChip v-if="stage.target === 'none'" tone="info" label="Final" />
          <span class="flex-1" />
          <button
            type="button"
            class="flex size-12 items-center justify-center rounded-button text-primary-deep disabled:text-border"
            :aria-label="`Subir etapa ${index + 1}`"
            :disabled="index === 0"
            @click="move(index, -1)"
          >
            <AppIcon name="arrow-up" />
          </button>
          <button
            type="button"
            class="flex size-12 items-center justify-center rounded-button text-primary-deep disabled:text-border"
            :aria-label="`Descer etapa ${index + 1}`"
            :disabled="index === stages.length - 1"
            @click="move(index, 1)"
          >
            <AppIcon name="arrow-down" />
          </button>
          <button
            type="button"
            class="flex size-12 items-center justify-center rounded-button text-status-late-text disabled:text-border"
            :aria-label="`Tirar etapa ${index + 1} do fluxo`"
            :disabled="stages.length <= MIN_STAGES"
            @click="remove(index)"
          >
            <AppIcon name="trash" />
          </button>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <AppTextField
            v-model="stage.name"
            label="Nome da etapa"
            :maxlength="40"
            @input="edited"
          />
          <AppSelect
            :model-value="stage.target"
            label="Onde o item aparece"
            :options="targetOptions"
            @update:model-value="setTarget(stage, $event)"
          />
          <AppSelect
            v-if="stage.target === 'fixed_station'"
            :model-value="stage.stationId ?? ''"
            label="Estação"
            :options="stationOptions(stage)"
            @update:model-value="setStation(stage, $event)"
          />
        </div>
        <ul v-if="stageIssues(index).length" class="flex flex-col gap-1">
          <li
            v-for="message in stageIssues(index)"
            :key="message"
            class="flex items-center gap-1.5 text-sm text-error"
          >
            <AppIcon name="alert-circle" :size="16" />
            {{ message }}
          </li>
        </ul>
      </li>
    </ol>

    <AppAlert v-if="generalIssues.length" tone="error">
      <p v-for="issue in generalIssues" :key="issue.code">{{ issue.message }}</p>
    </AppAlert>

    <AppButton variant="secondary" :disabled="stages.length >= MAX_STAGES" @click="add">
      <AppIcon name="plus" />
      Adicionar etapa
    </AppButton>

    <ErrorAlert
      v-if="action.error.value?.code !== 'INVALID_WORKFLOW'"
      :error="action.error.value"
      @reload="discard"
    />
    <AppAlert v-else-if="serverIssues.length" tone="error">
      {{ action.error.value.message }}
    </AppAlert>

    <div class="flex flex-col gap-2">
      <AppButton :disabled="!dirty" :loading="action.busy.value" @click="save">
        Salvar fluxo
      </AppButton>
      <AppButton v-if="dirty || changedElsewhere" variant="ghost" @click="discard">
        Descartar alterações
      </AppButton>
      <p v-if="!dirty" class="text-center text-sm text-text-muted">Fluxo salvo.</p>
      <p v-else class="text-center text-sm text-text-muted">
        Alterações ainda não salvas. Etapas retiradas ficam guardadas no histórico dos pedidos.
      </p>
    </div>
  </section>
</template>
