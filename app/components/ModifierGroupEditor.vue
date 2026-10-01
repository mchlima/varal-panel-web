<script setup lang="ts">
import type { components } from '~/api/schema'
import { centsToInput, formatDelta, parseReais } from '~/lib/money'
import { choicesLabel, modifierLimitsError, parseInteger } from '~/lib/setup'

type ModifierGroup = components['schemas']['ModifierGroup']
type Modifier = components['schemas']['Modifier']

/**
 * Grupo de modificadores de um produto (spec 03, seção 5.2): nome, mínimo e máximo
 * (RN-03.13), opções com acréscimo em centavos (≥ 0; remoção de ingrediente é acréscimo
 * zero, RN-03.14). O grupo pode ser apagado; opções só são desativadas.
 */
const props = defineProps<{ group: ModifierGroup }>()
const emit = defineEmits<{ changed: [] }>()

const { $api } = useNuxtApp()
const action = useApiAction()
const idempotency = useIdempotencyKey()

const editing = ref(false)
const groupForm = reactive({ name: '', min: '', max: '' })
const groupError = ref('')

function startEdit() {
  groupForm.name = props.group.name
  groupForm.min = String(props.group.minChoices)
  groupForm.max = String(props.group.maxChoices)
  groupError.value = ''
  editing.value = true
}

async function saveGroup() {
  const min = parseInteger(groupForm.min)
  const max = parseInteger(groupForm.max)
  groupError.value = !groupForm.name.trim()
    ? 'Informe o nome do grupo.'
    : min === null || max === null
      ? 'Use números inteiros no mínimo e no máximo.'
      : (modifierLimitsError(min, max) ?? '')
  if (groupError.value || min === null || max === null) return
  const result = await action.run(() =>
    $api.PATCH('/api/v1/modifier-groups/{id}', {
      params: { path: { id: props.group.id } },
      body: { name: groupForm.name.trim(), minChoices: min, maxChoices: max },
    }),
  )
  if (result.ok) {
    editing.value = false
    emit('changed')
  }
}

async function removeGroup() {
  const result = await action.run(() =>
    $api.DELETE('/api/v1/modifier-groups/{id}', { params: { path: { id: props.group.id } } }),
  )
  if (result.ok) emit('changed')
}

// Opções
const optionEditing = ref<string | null>(null)
const optionForm = reactive({ name: '', price: '' })
const optionError = ref('')

function startOption(option: Modifier | null) {
  optionEditing.value = option?.id ?? 'new'
  optionForm.name = option?.name ?? ''
  optionForm.price = option ? centsToInput(option.priceDeltaCents) : '0,00'
  optionError.value = ''
}

async function saveOption() {
  const cents = parseReais(optionForm.price)
  optionError.value = !optionForm.name.trim()
    ? 'Informe o nome da opção.'
    : cents === null
      ? 'Confira o acréscimo (ex.: 3,00). Use 0 para nenhum.'
      : ''
  if (optionError.value || cents === null) return
  const editingId = optionEditing.value
  const result =
    editingId && editingId !== 'new'
      ? await action.run(() =>
          $api.PATCH('/api/v1/modifiers/{id}', {
            params: { path: { id: editingId } },
            body: { name: optionForm.name.trim(), priceDeltaCents: cents },
          }),
        )
      : await action.run(() => {
          const body = {
            modifierGroupId: props.group.id,
            name: optionForm.name.trim(),
            priceDeltaCents: cents,
          }
          return $api.POST('/api/v1/modifiers', {
            params: { header: { 'Idempotency-Key': idempotency.keyFor(body) } },
            body,
          })
        })
  if (result.ok) {
    idempotency.reset()
    optionEditing.value = null
    emit('changed')
  }
}

async function toggleOption(option: Modifier) {
  const result = await action.run(() =>
    $api.PATCH('/api/v1/modifiers/{id}', {
      params: { path: { id: option.id } },
      body: { active: !option.active },
    }),
  )
  if (result.ok) emit('changed')
}
</script>

<template>
  <article
    class="flex flex-col gap-3 rounded-card border border-border bg-surface-muted p-3"
    :aria-label="`Grupo ${group.name}`"
    data-testid="modifier-group"
  >
    <form v-if="editing" class="flex flex-col gap-3" novalidate @submit.prevent="saveGroup">
      <AppTextField v-model="groupForm.name" label="Nome do grupo" :maxlength="60" />
      <div class="grid grid-cols-2 gap-3">
        <AppTextField v-model="groupForm.min" label="Mínimo" inputmode="numeric" />
        <AppTextField v-model="groupForm.max" label="Máximo" inputmode="numeric" />
      </div>
      <p v-if="groupError" class="flex items-center gap-1.5 text-sm text-error">
        <AppIcon name="alert-circle" :size="16" />{{ groupError }}
      </p>
      <div class="flex flex-wrap gap-2">
        <AppButton type="submit" variant="secondary" :block="false" :loading="action.busy.value">
          Salvar grupo
        </AppButton>
        <AppButton variant="ghost" :block="false" @click="editing = false">Cancelar</AppButton>
      </div>
    </form>
    <div v-else class="flex flex-wrap items-center gap-2">
      <div class="flex min-w-0 flex-1 flex-col">
        <h4 class="font-display text-lg font-semibold break-words">{{ group.name }}</h4>
        <span class="text-sm text-text-muted">
          {{ choicesLabel(group.minChoices, group.maxChoices) }}
        </span>
      </div>
      <AppButton variant="ghost" :block="false" class="px-2" @click="startEdit">
        <AppIcon name="edit" />
        Editar grupo
      </AppButton>
    </div>

    <ul class="flex flex-col gap-2">
      <li
        v-for="option in group.modifiers"
        :key="option.id"
        class="flex flex-col gap-2 rounded-button border border-border bg-surface px-3 py-2"
      >
        <form
          v-if="optionEditing === option.id"
          class="flex flex-col gap-3"
          novalidate
          @submit.prevent="saveOption"
        >
          <AppTextField v-model="optionForm.name" label="Nome da opção" :maxlength="60" />
          <AppTextField
            v-model="optionForm.price"
            label="Acréscimo"
            prefix="R$"
            inputmode="decimal"
          />
          <p v-if="optionError" class="text-sm text-error">{{ optionError }}</p>
          <div class="flex flex-wrap gap-2">
            <AppButton
              type="submit"
              variant="secondary"
              :block="false"
              :loading="action.busy.value"
            >
              Salvar opção
            </AppButton>
            <AppButton variant="ghost" :block="false" @click="optionEditing = null">
              Cancelar
            </AppButton>
          </div>
        </form>
        <div v-else class="flex flex-wrap items-center gap-2">
          <span class="min-w-0 flex-1">
            <span class="font-bold" :class="option.active ? '' : 'text-text-muted line-through'">
              {{ option.name }}
            </span>
            <span class="block text-sm text-text-muted">{{
              formatDelta(option.priceDeltaCents)
            }}</span>
          </span>
          <StatusChip v-if="!option.active" tone="inactive" label="Desativada" />
          <AppButton
            variant="ghost"
            :block="false"
            class="px-2"
            :aria-label="`Editar opção ${option.name}`"
            @click="startOption(option)"
          >
            <AppIcon name="edit" />
          </AppButton>
          <AppButton variant="ghost" :block="false" class="px-2" @click="toggleOption(option)">
            {{ option.active ? 'Desativar' : 'Ativar' }}
          </AppButton>
        </div>
      </li>
    </ul>

    <form
      v-if="optionEditing === 'new'"
      class="flex flex-col gap-3"
      novalidate
      aria-label="Nova opção"
      @submit.prevent="saveOption"
    >
      <AppTextField v-model="optionForm.name" label="Nome da opção" :maxlength="60" />
      <AppTextField v-model="optionForm.price" label="Acréscimo" prefix="R$" inputmode="decimal" />
      <p v-if="optionError" class="text-sm text-error">{{ optionError }}</p>
      <div class="flex flex-wrap gap-2">
        <AppButton type="submit" variant="secondary" :block="false" :loading="action.busy.value">
          Adicionar opção
        </AppButton>
        <AppButton variant="ghost" :block="false" @click="optionEditing = null">Cancelar</AppButton>
      </div>
    </form>
    <div v-else class="flex flex-wrap items-center gap-2">
      <AppButton variant="ghost" :block="false" class="px-2" @click="startOption(null)">
        <AppIcon name="plus" />
        Nova opção
      </AppButton>
      <ConfirmAction
        label="Apagar grupo"
        :question="`Apagar o grupo ${group.name}?`"
        confirm-label="Apagar grupo"
        :loading="action.busy.value"
        @confirm="removeGroup"
      >
        <template #icon><AppIcon name="trash" /></template>
        <p>As opções vão junto. Pedidos já feitos guardam o que foi escolhido.</p>
      </ConfirmAction>
    </div>

    <ErrorAlert :error="action.error.value" />
  </article>
</template>
