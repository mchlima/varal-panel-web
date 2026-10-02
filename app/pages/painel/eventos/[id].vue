<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
import { formatDateTime } from '~/lib/datetime'
import { MODALITY_HINTS, eventActions, eventDates } from '~/lib/events'
import { formatCents } from '~/lib/money'
import { MODALITY_LABELS, priceListName, type ContractedEvent } from '~/lib/operation'
import { canOperateCashIn } from '~/lib/routes'
import { uuidv7 } from '~/lib/uuid'

/**
 * Detalhe do evento (`/painel/eventos/{id}`, spec 04, seção 8.3): situação, acordo, tabela de
 * preço, "Iniciar evento" e "Encerrar evento" (dono e quem opera caixa, RN-04.34; um em andamento
 * por unidade, RN-04.35), "Cancelar evento" (só agendado, só o dono), edição do dono até encerrar
 * (RN-04.37) e o link para o relatório do evento (só o dono, RN-07.07).
 */
const route = useRoute()
const { $api } = useNuxtApp()
const session = useSessionStore()
const store = useContractedEventsStore()
const action = useApiAction()
const id = computed(() => String(route.params.id))

const event = ref<ContractedEvent | null>(null)
const loadError = ref('')
const editing = ref(false)

useHead({ title: () => `${event.value?.contractorName ?? 'Evento'} · Varal` })

async function load() {
  try {
    const { data, error } = await $api.GET('/api/v1/events/{id}', {
      params: { path: { id: id.value } },
    })
    if (!data) {
      loadError.value = apiErrorMessage(error)
      return
    }
    loadError.value = ''
    event.value = data
    store.apply(data)
  } catch (error) {
    loadError.value = apiErrorMessage(error)
  }
}
watch(id, load, { immediate: true })
useRealtimeResync(load)
useRealtimeEvent('event.updated', (payload) => {
  if (payload.data.id !== event.value?.id) return
  if (payload.data.version > event.value.version) event.value = payload.data
  store.apply(payload.data)
})

const actions = computed(() =>
  event.value
    ? eventActions(event.value, {
        isOwner: session.isOwner,
        canOperateCash: canOperateCashIn(session.me, event.value.unitId),
      })
    : null,
)

/** Inicia, encerra ou cancela (RN-04.34), com a versão conhecida. */
async function run(kind: 'start' | 'finish' | 'cancel') {
  const current = event.value
  if (!current) return
  const options = {
    params: { path: { id: current.id }, header: { 'Idempotency-Key': uuidv7() } },
    body: { version: current.version },
  }
  const result = await action.run(() =>
    kind === 'start'
      ? $api.POST('/api/v1/events/{id}/start', options)
      : kind === 'finish'
        ? $api.POST('/api/v1/events/{id}/finish', options)
        : $api.POST('/api/v1/events/{id}/cancel', options),
  )
  if (result.ok && result.data) {
    event.value = result.data
    store.apply(result.data)
  }
}

function saved(next: ContractedEvent) {
  event.value = next
  store.apply(next)
  editing.value = false
}
</script>

<template>
  <PanelShell>
    <NuxtLink
      to="/painel/eventos"
      class="inline-flex min-h-12 items-center gap-1 self-start font-bold text-primary-deep"
    >
      <AppIcon name="arrow-left" />
      Eventos
    </NuxtLink>

    <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
    <p v-else-if="!event" class="text-text-muted">Carregando evento…</p>

    <template v-else-if="editing">
      <h1 class="text-2xl">Editar evento</h1>
      <EventForm :unit-id="event.unitId" :event="event" @saved="saved" @cancel="editing = false" />
    </template>

    <template v-else>
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl">{{ event.contractorName }}</h1>
          <EventStatusChip :status="event.status" />
        </div>
        <p class="text-text-muted">{{ eventDates(event) }}</p>
      </div>

      <AppAlert v-if="event.status === 'in_progress'" tone="success">
        <p class="font-bold">Evento em andamento.</p>
        <p>
          As comandas novas ficam ligadas a ele e usam os preços de
          {{ priceListName(event.priceList) }}.
        </p>
      </AppAlert>
      <AppAlert v-else-if="event.status === 'scheduled' && actions?.start">
        No dia, toque em "Iniciar evento". Também dá para iniciar junto ao abrir o caixa.
      </AppAlert>

      <ErrorAlert :error="action.error.value" @reload="load" />

      <AppButton
        v-if="actions?.start"
        :loading="action.busy.value"
        data-testid="start-event"
        @click="run('start')"
      >
        <AppIcon name="party" />
        Iniciar evento
      </AppButton>
      <AppButton
        v-if="actions?.finish"
        :loading="action.busy.value"
        data-testid="finish-event"
        @click="run('finish')"
      >
        <AppIcon name="check" />
        Encerrar evento
      </AppButton>

      <section
        class="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
        aria-labelledby="agreement-title"
      >
        <h2 id="agreement-title" class="text-xl">Acordo</h2>
        <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt class="text-sm text-text-muted">Como foi combinado</dt>
            <dd class="font-bold">{{ MODALITY_LABELS[event.modality] }}</dd>
            <dd class="text-sm text-text-muted">{{ MODALITY_HINTS[event.modality] }}</dd>
          </div>
          <div>
            <dt class="text-sm text-text-muted">Tabela de preço</dt>
            <dd class="font-bold">{{ priceListName(event.priceList) }}</dd>
          </div>
          <div>
            <dt class="text-sm text-text-muted">Valor combinado</dt>
            <dd class="font-bold tabular-nums">
              {{
                event.agreedAmountCents === null
                  ? 'Não informado'
                  : formatCents(event.agreedAmountCents)
              }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-text-muted">Quantidade combinada</dt>
            <dd class="font-bold tabular-nums">
              {{ event.agreedQuantity === null ? 'Não informada' : event.agreedQuantity }}
            </dd>
          </div>
          <div v-if="event.limits">
            <dt class="text-sm text-text-muted">Limites</dt>
            <dd class="font-bold">{{ event.limits }}</dd>
          </div>
          <div v-if="event.notes" class="sm:col-span-2">
            <dt class="text-sm text-text-muted">Observação</dt>
            <dd>{{ event.notes }}</dd>
          </div>
          <div v-if="event.startedAt">
            <dt class="text-sm text-text-muted">Início</dt>
            <dd>{{ formatDateTime(event.startedAt) }}</dd>
          </div>
          <div v-if="event.finishedAt">
            <dt class="text-sm text-text-muted">Encerramento</dt>
            <dd>{{ formatDateTime(event.finishedAt) }}</dd>
          </div>
        </dl>
      </section>

      <div class="flex flex-wrap gap-2">
        <AppButton
          v-if="actions?.report"
          variant="secondary"
          :block="false"
          :to="`/painel/relatorios/eventos/${event.id}`"
        >
          <AppIcon name="chart" />
          Ver relatório do evento
        </AppButton>
        <AppButton
          v-if="actions?.edit"
          variant="secondary"
          :block="false"
          data-testid="edit-event"
          @click="((editing = true), action.clear())"
        >
          <AppIcon name="edit" />
          Editar evento
        </AppButton>
      </div>

      <ConfirmAction
        v-if="actions?.cancel"
        label="Cancelar evento"
        question="Cancelar este evento? Ele não poderá ser iniciado depois."
        confirm-label="Cancelar evento"
        :loading="action.busy.value"
        @confirm="run('cancel')"
      >
        <template #icon><AppIcon name="x" /></template>
      </ConfirmAction>
    </template>
  </PanelShell>
</template>
