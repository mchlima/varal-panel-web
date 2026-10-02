<script setup lang="ts">
import {
  CONTRACTOR_NAME_MAX,
  EVENT_LIMITS_MAX,
  EVENT_NOTES_MAX,
  MODALITY_HINTS,
  buildEventBody,
  emptyEventForm,
  eventToForm,
  type EventForm,
  type EventFormErrors,
} from '~/lib/events'
import { MODALITY_LABELS, todayInSaoPaulo, type ContractedEvent } from '~/lib/operation'

/**
 * Cadastro e edição do evento contratado (spec 04, RN-04.05 e seção 8.3): contratante, data e
 * data final, acordo (modalidade, valor, quantidade, limites, observação) e tabela de preço
 * ("Normal" ou uma tabela ativa, com atalho para criar no cardápio). Só o dono; editar vale até o
 * evento ser encerrado (RN-04.37). Só com conexão.
 */
const props = withDefaults(defineProps<{ unitId: string; event?: ContractedEvent | null }>(), {
  event: null,
})
const emit = defineEmits<{ saved: [event: ContractedEvent]; cancel: [] }>()

const { $api } = useNuxtApp()
const menu = useMenuStore()
const action = useApiAction()
const idempotency = useIdempotencyKey()

const form = reactive<EventForm>(
  props.event ? eventToForm(props.event) : emptyEventForm(todayInSaoPaulo()),
)
const errors = ref<EventFormErrors>({})

watch(
  () => props.unitId,
  (id) => {
    if (id && (menu.unitId !== id || !menu.menu)) void menu.load(id)
  },
  { immediate: true },
)

const modalityOptions = computed(() =>
  (Object.keys(MODALITY_LABELS) as (keyof typeof MODALITY_LABELS)[]).map((value) => ({
    value,
    label: MODALITY_LABELS[value],
  })),
)
const priceListOptions = computed(() => {
  const active = (menu.menu?.priceLists ?? []).filter((list) => list.active)
  const options = [
    { value: '', label: 'Normal (preço do cardápio)' },
    ...active.map((list) => ({ value: list.id, label: list.name })),
  ]
  const kept = props.event?.priceList
  if (kept && !options.some((option) => option.value === kept.id)) {
    options.push({ value: kept.id, label: `${kept.name} (desativada)` })
  }
  return options
})
const modality = computed({
  get: () => form.modality,
  set: (value: string) => (form.modality = value as EventForm['modality']),
})

async function save() {
  const { body, errors: invalid } = buildEventBody(form)
  errors.value = invalid
  if (!body) return
  const current = props.event
  if (current) {
    const result = await action.run(() =>
      $api.PATCH('/api/v1/events/{id}', {
        params: { path: { id: current.id } },
        body: { ...body, version: current.version },
      }),
    )
    if (result.ok && result.data) emit('saved', result.data)
    return
  }
  const result = await action.run(() =>
    $api.POST('/api/v1/units/{id}/events', {
      params: {
        path: { id: props.unitId },
        header: { 'Idempotency-Key': idempotency.keyFor(body) },
      },
      body,
    }),
  )
  if (result.ok && result.data) {
    idempotency.reset()
    emit('saved', result.data)
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate aria-label="Dados do evento" @submit.prevent="save">
    <AppTextField
      v-model="form.contractorName"
      label="Contratante"
      hint="Quem contratou ou o nome do evento. Ex.: Casamento Ana e Leo."
      :maxlength="CONTRACTOR_NAME_MAX"
      :error="errors.contractorName ?? ''"
    />
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <AppTextField
        v-model="form.startsOn"
        type="date"
        label="Data"
        :error="errors.startsOn ?? ''"
      />
      <AppTextField
        v-model="form.endsOn"
        type="date"
        label="Data final (opcional)"
        hint="Só para eventos de mais de um dia."
        :error="errors.endsOn ?? ''"
      />
    </div>

    <fieldset class="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
      <legend class="px-1 font-display text-lg font-semibold">Acordo</legend>
      <AppSelect
        v-model="modality"
        label="Como foi combinado"
        :hint="MODALITY_HINTS[form.modality]"
        :options="modalityOptions"
      />
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AppTextField
          v-model="form.agreedAmount"
          label="Valor combinado (opcional)"
          prefix="R$"
          inputmode="decimal"
          placeholder="0,00"
          :error="errors.agreedAmount ?? ''"
        />
        <AppTextField
          v-model="form.agreedQuantity"
          label="Quantidade combinada (opcional)"
          hint="O relatório compara com o que foi consumido."
          inputmode="numeric"
          :error="errors.agreedQuantity ?? ''"
        />
      </div>
      <AppTextField
        v-model="form.limits"
        label="Limites (opcional)"
        hint="Ex.: 500 espetos, das 18h às 23h."
        :maxlength="EVENT_LIMITS_MAX"
        :error="errors.limits ?? ''"
      />
      <AppTextField
        v-model="form.notes"
        label="Observação (opcional)"
        :maxlength="EVENT_NOTES_MAX"
        :error="errors.notes ?? ''"
      />
    </fieldset>

    <div class="flex flex-col gap-2">
      <AppSelect
        v-model="form.priceListId"
        label="Tabela de preço"
        hint="Enquanto o evento estiver em andamento, o balcão cobra os preços desta tabela."
        :options="priceListOptions"
      />
      <NuxtLink
        to="/painel/cardapio/tabelas"
        class="inline-flex min-h-12 items-center gap-1 self-start font-bold text-primary-deep underline-offset-4 hover:underline"
      >
        <AppIcon name="plus" />
        Criar tabela de preço no cardápio
      </NuxtLink>
    </div>

    <ErrorAlert :error="action.error.value" @reload="emit('cancel')" />
    <AppButton type="submit" :loading="action.busy.value" data-testid="save-event">
      {{ event ? 'Salvar evento' : 'Cadastrar evento' }}
    </AppButton>
    <AppButton v-if="event" variant="ghost" @click="emit('cancel')">Cancelar</AppButton>
  </form>
</template>
