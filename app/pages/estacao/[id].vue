<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
import { compareQueueItems, createStationQueue } from '~/lib/live-collection'
import {
  changedItemOf,
  itemConflictMessage,
  nextStage,
  previousStage,
  stagesOfStation,
  type ItemChange,
  type OrderItem,
  type WorkflowStage,
} from '~/lib/operation'
import { pendingForItem, pendingLabel } from '~/lib/operation-actions'

/**
 * Fila de uma estação (`/estacao/{id}`, spec 04, seção 8.2): itens em tempo real, pedido mais
 * antigo primeiro e itens do mesmo pedido juntos; avançar com um toque, avançar parte
 * (RN-04.24), voltar (RN-04.22) e cancelar com motivo (RN-04.25). Toda mudança vai pela fila
 * local com a `version` conhecida; se outro aparelho mexeu antes (`ITEM_CHANGED`, CA-04.05), o
 * cartão mostra o estado atual e avisa. Tela sempre ligada, som e vibração em item novo.
 *
 * Tempo real (RN-01.05, CA-04.12): a cada (re)conexão a fila vem do REST; eventos que chegam
 * durante a busca são aplicados depois, e os de `version` menor ou igual são ignorados.
 */
definePageMeta({ key: (route) => route.fullPath })

const route = useRoute()
const session = useSessionStore()
const workplace = useWorkplaceStore()
const connection = useConnectionStore()
const operations = useOperations()
const itemActions = useItemActions()
const alerts = useStationAlerts()
const awake = useScreenAwake()
const now = useClock(15_000)
const stationId = computed(() => String(route.params.id))

/** Só estações liberadas no `/auth/me` (RN-03.16); a API confere de novo em cada ação. */
const place = computed(() => {
  for (const unit of session.me?.units ?? []) {
    const station = unit.stations.find((item) => item.id === stationId.value)
    if (station) return { unit, station }
  }
  return null
})

watch(
  place,
  (value) => {
    if (!value) return
    workplace.selectUnit(value.unit.id)
    workplace.selectStation(value.station.id)
  },
  { immediate: true },
)

useHead({ title: () => `${place.value?.station.name ?? 'Estação'} · Varal` })

const queue = reactive(createStationQueue(stationId.value))
const stages = ref<WorkflowStage[]>([])
const loaded = ref(false)
const loadError = ref('')
const fresh = ref<Record<string, true>>({})
const notices = ref<Record<string, string>>({})
/** Avisos de itens que já saíram desta fila (outro aparelho os levou). */
const looseNotices = ref<{ id: string; text: string }[]>([])
const stageFilter = ref<string | null>(null)
const soldOutOpen = ref(false)
let generation = 0

async function load(): Promise<void> {
  if (!place.value || place.value.station.kind !== 'queue') return
  const { $api } = useNuxtApp()
  const current = ++generation
  queue.beginReload()
  try {
    const { data, error } = await $api.GET('/api/v1/stations/{id}/queue', {
      params: { path: { id: stationId.value } },
    })
    if (current !== generation) return
    if (!data) {
      loadError.value = apiErrorMessage(error)
      queue.abortReload()
      return
    }
    loadError.value = ''
    stages.value = data.stages
    queue.finishReload(data.items)
    loaded.value = true
  } catch (error) {
    if (current !== generation) return
    loadError.value = apiErrorMessage(error)
    queue.abortReload()
  }
}

watch(
  () => place.value?.station.id,
  (id) => {
    if (id) void load()
  },
  { immediate: true },
)
useRealtimeResync(load)

/** Item que acabou de entrar nesta fila: destaque até ser tocado, som e vibração. */
function arrived(item: OrderItem) {
  fresh.value = { ...fresh.value, [item.id]: true }
  alerts.notify()
}

function receive(item: OrderItem | null | undefined, fromStationId?: string | null) {
  if (!item) return
  const isHere = item.stationId === stationId.value && item.canceledAt === null
  const wasHere = item.id in queue.items
  const changed = queue.apply(item)
  if (changed && isHere && !wasHere && fromStationId !== stationId.value) arrived(item)
}

useRealtimeEvent('order.created', (event) => {
  // CA-04.03: a sala da estação recebe só os itens dela; a da unidade, o pedido inteiro.
  for (const item of event.data.items) {
    if (item.stationId === stationId.value) receive(item, null)
  }
})
useRealtimeEvent('order_item.stage_changed', (event) => {
  receive(event.data.item, event.data.previousStationId)
  receive(event.data.remaining, event.data.remaining?.stationId)
})
useRealtimeEvent('order_item.canceled', (event) => {
  receive(event.data.item, event.data.previousStationId)
  receive(event.data.remaining, event.data.remaining?.stationId)
})
useRealtimeEvent('shift.closed', (event) => {
  // RN-04.08: itens não finais vão à etapa final no fechamento; a fila esvazia.
  if (event.unitId === place.value?.unit.id) void load()
})
useRealtimeEvent('unit.config_updated', (event) => {
  if (event.unitId === place.value?.unit.id) void load()
})

// Resposta de uma ação deste aparelho: aplica na hora (o evento confirma depois).
operations.onSettled((meta, outcome) => {
  if (!meta.kind.startsWith('item.') || !outcome.ok) return
  const change = outcome.body as ItemChange | undefined
  receive(change?.changed, stationId.value)
  receive(change?.remaining, stationId.value)
})

// CA-04.05: outro aparelho mexeu no item antes. O cartão mostra o estado atual e o aviso.
useOperationFailures((meta, failure) => {
  if (!meta.kind.startsWith('item.') || !('itemId' in meta)) return false
  if (!(meta.itemId in queue.versions)) return false
  const message = itemConflictMessage(failure.code, changedItemOf(failure.details))
  if (!message) return false
  const current = changedItemOf(failure.details)
  if (current) receive(current, stationId.value)
  else void load()
  const id = current?.id ?? meta.itemId
  if (id in queue.items) notices.value = { ...notices.value, [id]: message }
  else looseNotices.value = [...looseNotices.value, { id: `${id}:${Date.now()}`, text: message }]
  return true
})

const items = computed(() => queue.list().sort(compareQueueItems))
const filterStages = computed(() => stagesOfStation(stages.value, stationId.value))
const visibleItems = computed(() =>
  stageFilter.value
    ? items.value.filter((item) => item.stageId === stageFilter.value)
    : items.value,
)

function seen(id: string) {
  if (!(id in fresh.value)) return
  const { [id]: _done, ...rest } = fresh.value
  fresh.value = rest
}

function dismissNotice(id: string) {
  const { [id]: _done, ...rest } = notices.value
  notices.value = rest
}

function itemPending(item: OrderItem): string | undefined {
  const op = pendingForItem(connection.pending, item.id)
  if (!op || !('quantity' in op.meta)) return undefined
  return itemPendingText(op.meta, pendingLabel(op.action, connection.online))
}

function advance(item: OrderItem, quantity: number) {
  const next = nextStage(stages.value, item.stageId)
  void itemActions.advance(item, { quantity, toStageName: next?.name })
}

function back(item: OrderItem) {
  void itemActions.back(item, previousStage(stages.value, item.stageId)?.name)
}

function cancel(item: OrderItem, value: { quantity: number; reason: string }) {
  void itemActions.cancel(item, value.quantity, value.reason)
}
</script>

<template>
  <div>
    <OperationShell :title="place?.station.name ?? 'Estação'" :unit-name="place?.unit.name" wide>
      <template v-if="place" #actions>
        <button
          type="button"
          class="flex min-h-12 items-center gap-1.5 rounded-button px-2 text-sm font-bold"
          :class="alerts.enabled.value ? 'text-primary-deep' : 'text-text-muted'"
          :aria-pressed="alerts.enabled.value"
          data-testid="alerts-toggle"
          @click="alerts.setEnabled(!alerts.enabled.value)"
        >
          <AppIcon :name="alerts.enabled.value ? 'bell' : 'bell-off'" />
          <span class="hidden sm:inline">{{
            alerts.enabled.value ? 'Alertas ligados' : 'Alertas desligados'
          }}</span>
          <span class="sr-only sm:hidden">{{
            alerts.enabled.value ? 'Alertas ligados' : 'Alertas desligados'
          }}</span>
        </button>
        <button
          type="button"
          class="flex min-h-12 items-center gap-1.5 rounded-button px-2 text-sm font-bold text-primary-deep"
          @click="soldOutOpen = true"
        >
          <AppIcon name="ban" />
          <span class="hidden sm:inline">Esgotados</span>
          <span class="sr-only sm:hidden">Esgotados</span>
        </button>
      </template>

      <AppAlert v-if="!place" tone="error">
        Esta estação não existe ou não está liberada para você. Escolha outra em "Trocar de
        estação".
      </AppAlert>
      <AppAlert v-else-if="place.station.kind !== 'queue'">
        Esta é uma estação de balcão.
        <NuxtLink to="/balcao" class="font-bold underline">Abrir o balcão</NuxtLink>
      </AppAlert>
      <template v-else>
        <button
          v-if="alerts.needsActivation.value"
          type="button"
          class="flex min-h-14 w-full items-center justify-center gap-2 rounded-card border-2 border-primary bg-primary-soft px-4 font-bold text-primary-deep"
          data-testid="activate-alerts"
          @click="alerts.unlock()"
        >
          <AppIcon name="bell" />
          Toque para ativar alertas
        </button>
        <AppAlert v-if="awake.refused.value" data-testid="wake-lock-hint">
          <p class="font-bold">A tela pode apagar sozinha.</p>
          <p>
            Este navegador não deixou manter a tela ligada. Ajuste o tempo de tela do aparelho
            (Configurações → Tela → Tempo limite) para não perder pedidos.
          </p>
        </AppAlert>
        <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
        <AppAlert v-for="notice in looseNotices" :key="notice.id" tone="error">
          <p>{{ notice.text }}</p>
          <button
            type="button"
            class="mt-1 min-h-12 font-bold underline"
            @click="looseNotices = looseNotices.filter((item) => item.id !== notice.id)"
          >
            Entendi
          </button>
        </AppAlert>

        <div
          v-if="filterStages.length > 1"
          role="group"
          aria-label="Filtrar por etapa"
          class="-mx-4 flex gap-2 overflow-x-auto px-4"
        >
          <button
            v-for="option in [{ id: null, name: 'Todas' }, ...filterStages]"
            :key="option.id ?? 'all'"
            type="button"
            :aria-pressed="stageFilter === option.id"
            class="min-h-12 shrink-0 rounded-button border-2 px-4 font-bold whitespace-nowrap"
            :class="
              stageFilter === option.id
                ? 'border-primary bg-primary-soft text-primary-deep'
                : 'border-border-strong bg-surface text-text'
            "
            @click="stageFilter = option.id"
          >
            {{ option.name }}
            <span class="tabular-nums">
              ({{
                option.id
                  ? items.filter((item) => item.stageId === option.id).length
                  : items.length
              }})
            </span>
          </button>
        </div>

        <p v-if="!loaded && !loadError" class="text-text-muted">Carregando fila…</p>
        <div
          v-else-if="loaded && visibleItems.length === 0"
          class="flex flex-col items-center gap-2 rounded-card border-2 border-dashed border-border-strong p-8 text-center text-text-muted"
          data-testid="queue-empty"
        >
          <AppIcon name="check-circle" :size="32" />
          <p class="text-lg font-bold">Nada na fila agora.</p>
          <p>Os itens novos aparecem aqui sozinhos.</p>
        </div>
        <ul class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-live="polite">
          <li v-for="item in visibleItems" :key="item.id">
            <QueueItemCard
              :item="item"
              :stages="stages"
              :now="now"
              :fresh="item.id in fresh"
              :pending="itemPending(item)"
              :notice="notices[item.id]"
              @seen="seen(item.id)"
              @advance="advance(item, $event)"
              @back="back(item)"
              @cancel="cancel(item, $event)"
              @dismiss-notice="dismissNotice(item.id)"
            />
          </li>
        </ul>
      </template>
    </OperationShell>

    <AppDialog v-if="place" v-model:open="soldOutOpen" title="Esgotados">
      <MenuSoldOutList :unit-id="place.unit.id" />
    </AppDialog>
  </div>
</template>
