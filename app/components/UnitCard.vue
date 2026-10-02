<script setup lang="ts">
import type { components } from '~/api/schema'
import { LATE_AFTER_MAX, LATE_AFTER_MIN, parseInteger } from '~/lib/setup'

type Unit = components['schemas']['Unit']

/**
 * Uma unidade na lista (spec 03, seção 3): renomear, tempo de atraso padrão, ativar e desativar,
 * e os atalhos para estações e fluxo e para os caixas (spec 05, seção 8). RN-03.02: a API recusa
 * desativar com caixa aberto (`CASH_REGISTER_OPEN`), com comandas em aberto
 * (`UNIT_HAS_OPEN_TABS`) ou a última unidade ativa (`LAST_ACTIVE_UNIT`); a tela explica o motivo.
 */
const props = defineProps<{ unit: Unit }>()
const emit = defineEmits<{ changed: [] }>()

const { $api } = useNuxtApp()
const action = useApiAction()
const editing = ref(false)
const form = reactive({ name: '', late: '' })
const errors = ref<{ name?: string; late?: string }>({})

function startEdit() {
  form.name = props.unit.name
  form.late = String(props.unit.lateAfterMinutes)
  errors.value = {}
  action.clear()
  editing.value = true
}

async function patch(body: { name?: string; lateAfterMinutes?: number; active?: boolean }) {
  const result = await action.run(() =>
    $api.PATCH('/api/v1/units/{id}', {
      params: { path: { id: props.unit.id } },
      body: { ...body, version: props.unit.version },
    }),
  )
  if (result.ok) {
    editing.value = false
    emit('changed')
  }
}

function save() {
  const late = parseInteger(form.late)
  errors.value = {}
  if (!form.name.trim()) errors.value.name = 'Informe o nome da unidade.'
  if (late === null || late < LATE_AFTER_MIN || late > LATE_AFTER_MAX) {
    errors.value.late = `Use um número de ${LATE_AFTER_MIN} a ${LATE_AFTER_MAX}.`
  }
  if (Object.keys(errors.value).length || late === null) return
  void patch({ name: form.name.trim(), lateAfterMinutes: late })
}
</script>

<template>
  <article
    class="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    :aria-label="unit.name"
    data-testid="unit-card"
  >
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="min-w-0 flex-1 truncate text-xl">{{ unit.name }}</h2>
      <StatusChip
        :tone="unit.active ? 'active' : 'inactive'"
        :label="unit.active ? 'Ativa' : 'Desativada'"
      />
    </div>
    <p class="flex items-center gap-2 text-text-muted">
      <AppIcon name="clock" />
      Atraso padrão das estações novas:
      <strong class="text-text">{{ unit.lateAfterMinutes }} min</strong>
    </p>

    <form v-if="editing" class="flex flex-col gap-3" novalidate @submit.prevent="save">
      <AppTextField
        v-model="form.name"
        label="Nome da unidade"
        :error="errors.name"
        :maxlength="80"
      />
      <AppTextField
        v-model="form.late"
        label="Atraso padrão das estações novas (minutos)"
        inputmode="numeric"
        :hint="`De ${LATE_AFTER_MIN} a ${LATE_AFTER_MAX} minutos. Padrão: 15. Cada estação tem o seu tempo, em Estações e fluxo.`"
        :error="errors.late"
      />
      <div class="flex flex-wrap gap-2">
        <AppButton type="submit" variant="secondary" :block="false" :loading="action.busy.value">
          Salvar
        </AppButton>
        <AppButton variant="ghost" :block="false" @click="editing = false">Cancelar</AppButton>
      </div>
    </form>

    <ErrorAlert :error="action.error.value" @reload="emit('changed')" />

    <div v-if="!editing" class="flex flex-wrap items-center gap-2">
      <AppButton
        v-if="unit.active"
        variant="secondary"
        :block="false"
        :to="`/painel/unidades/${unit.id}/fluxo`"
      >
        <AppIcon name="flow" />
        Estações e fluxo
      </AppButton>
      <AppButton
        v-if="unit.active"
        variant="secondary"
        :block="false"
        :to="`/painel/unidades/${unit.id}/caixas`"
        data-testid="unit-registers"
      >
        <AppIcon name="wallet" />
        Caixas
      </AppButton>
      <AppButton variant="ghost" :block="false" @click="startEdit">
        <AppIcon name="edit" />
        Editar
      </AppButton>
      <ConfirmAction
        v-if="unit.active"
        label="Desativar"
        :question="`Desativar ${unit.name}?`"
        confirm-label="Desativar unidade"
        :loading="action.busy.value"
        @confirm="patch({ active: false })"
      >
        <template #icon><AppIcon name="power" /></template>
        <p>
          A unidade some do balcão e das estações, e a equipe dela perde o acesso. Nada é apagado:
          dá para ativar de novo.
        </p>
      </ConfirmAction>
      <AppButton
        v-else
        variant="ghost"
        :block="false"
        :loading="action.busy.value"
        @click="patch({ active: true })"
      >
        <AppIcon name="power" />
        Ativar
      </AppButton>
    </div>
  </article>
</template>
