<script setup lang="ts">
import { readLocal, writeLocal } from '~/lib/browser'
import { itemsLabel, stagesOfStation, type StationLine } from '~/lib/operation'
import { pendingForItem, pendingLabel, pendingOperations } from '~/lib/operation-actions'
import {
  CARD_SIZE_LABELS,
  CARD_WIDTHS,
  counters,
  matchesFilter,
  sortCards,
  type CardFilter,
  type CardSize,
  type RecentOrder,
  type StationCard,
} from '~/lib/station'

/**
 * Tela da estação (`/estacao/{id}`, spec 04, seção 8.2), no formato dos KDS de mercado: um pedido,
 * um cartão (RN-04.40), grade que ocupa toda a largura em telas grandes com o mais antigo no
 * canto superior esquerdo e uma coluna no celular (CA-04.18), contadores que filtram, tela
 * cheia, "Desfazer" e "Recentes". Tela sempre ligada, som e vibração em pedido novo e em
 * cancelamento. A barra do topo traz "Painel" e "Trocar de estação" (RN-01.25, RN-01.26).
 */
definePageMeta({ key: (route) => route.fullPath })

const SIZE_KEY = 'varal.kdsCardSize'

const route = useRoute()
const session = useSessionStore()
const workplace = useWorkplaceStore()
const connection = useConnectionStore()
const alerts = useStationAlerts()
const awake = useScreenAwake()
const fullscreen = useStationFullscreen()
const now = useClock(1_000)
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

const queue = useStationQueue({
  stationId,
  unitId: computed(() => place.value?.unit.id ?? null),
  enabled: computed(() => place.value?.station.kind === 'queue'),
  notify: () => alerts.notify(),
})

const filter = ref<CardFilter>({ kind: 'all' })
const soldOutOpen = ref(false)
const recentsOpen = ref(false)
const installHintOpen = ref(false)
const recentNotice = ref('')

const storedSize = readLocal(SIZE_KEY)
const size = ref<CardSize>(storedSize === 'small' || storedSize === 'large' ? storedSize : 'medium')
const SIZES: CardSize[] = ['small', 'medium', 'large']
function nextSize() {
  size.value = SIZES[(SIZES.indexOf(size.value) + 1) % SIZES.length]!
  writeLocal(SIZE_KEY, size.value)
}

const context = computed(() => ({
  limits: queue.limits.value,
  now: now.value,
  isNew: queue.isNew,
}))
const stationStages = computed(() => stagesOfStation(queue.stages.value, stationId.value))
const allCards = computed(() => sortCards(Object.values(queue.cards.value)))
const counterEntries = computed(() => counters(allCards.value, stationStages.value, context.value))
const visibleCards = computed(() =>
  allCards.value.filter(
    (card) => card.ackRequired || matchesFilter(card, filter.value, context.value),
  ),
)
const stageFilter = computed(() => (filter.value.kind === 'stage' ? filter.value.stageId : null))

function sameFilter(a: CardFilter, b: CardFilter): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Pendências da fila local, por linha e por pedido (spec 01, seção 11). */
const linePending = computed(() => {
  const result: Record<string, string> = {}
  for (const card of allCards.value) {
    for (const line of card.lines) {
      const op = pendingForItem(connection.pending, line.id)
      if (op && 'quantity' in op.meta) {
        result[line.id] = itemPendingText(op.meta, pendingLabel(op.action, connection.online))
      }
    }
  }
  return result
})
const cardPending = computed(() => {
  const result: Record<string, string> = {}
  for (const op of pendingOperations(
    connection.pending,
    (meta) => meta.kind === 'order.advance' && meta.stationId === stationId.value,
  )) {
    if (op.meta.kind !== 'order.advance') continue
    const target = op.meta.toStageName ?? 'Avançar'
    result[op.meta.orderId] = `${target}: ${pendingLabel(op.action, connection.online)}`
  }
  return result
})

async function toggleFullscreen() {
  if (fullscreen.active.value) return fullscreen.exit()
  if (!(await fullscreen.enter())) installHintOpen.value = true
}

function revert(entry: RecentOrder) {
  recentNotice.value = queue.revertRecent(entry) ?? ''
  if (!recentNotice.value) recentsOpen.value = false
}

function linesSummary(lines: readonly StationLine[]): string {
  return lines.map((line) => `${line.quantity}× ${line.productName}`).join(', ')
}

function minutesAgo(at: number): string {
  const minutes = Math.max(0, Math.floor((now.value - at) / 60_000))
  return minutes < 1 ? 'agora' : `há ${minutes} min`
}

function cancelLine(line: StationLine, value: { quantity: number; reason: string }) {
  queue.cancelLine(line, value.quantity, value.reason)
}

function cardKey(card: StationCard) {
  return card.orderId
}
</script>

<template>
  <div>
    <OperationShell
      :title="place?.station.name ?? 'Estação'"
      :unit-name="place?.unit.name"
      width="full"
      :bare="fullscreen.active.value"
    >
      <template v-if="place?.station.kind === 'queue'" #top>
        <div class="border-b border-border bg-surface">
          <div class="flex flex-col gap-2 px-4 py-2">
            <div
              role="group"
              aria-label="Filtrar pedidos"
              class="-mx-4 flex gap-2 overflow-x-auto px-4"
              data-testid="counters"
            >
              <button
                v-for="entry in counterEntries"
                :key="entry.key"
                type="button"
                :aria-pressed="sameFilter(filter, entry.filter)"
                class="flex min-h-12 shrink-0 items-center gap-2 rounded-button border-2 px-3 font-bold whitespace-nowrap"
                :class="
                  sameFilter(filter, entry.filter)
                    ? 'border-primary bg-primary-soft text-primary-deep'
                    : entry.key === 'late'
                      ? 'border-status-late-text bg-status-late-bg text-status-late-text'
                      : entry.key === 'attention'
                        ? 'border-status-attention-ink bg-status-attention-bg text-status-attention-ink'
                        : 'border-border-strong bg-surface text-text'
                "
                :data-testid="`counter-${entry.key.split(':')[0]}`"
                @click="filter = entry.filter"
              >
                <AppIcon v-if="entry.key === 'attention'" name="hourglass" :size="16" />
                <AppIcon v-else-if="entry.key === 'late'" name="alert-circle" :size="16" />
                <AppIcon v-else-if="entry.key === 'new'" name="dot" :size="16" />
                {{ entry.label }}
                <span class="tabular-nums">{{ entry.count }}</span>
              </button>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="flex min-h-12 items-center gap-1.5 rounded-button px-2 font-bold text-primary-deep hover:bg-primary-soft"
                data-testid="recents"
                @click="((recentNotice = ''), (recentsOpen = true))"
              >
                <AppIcon name="history" />
                Recentes
              </button>
              <button
                type="button"
                class="flex min-h-12 items-center gap-1.5 rounded-button px-2 font-bold text-primary-deep hover:bg-primary-soft"
                @click="soldOutOpen = true"
              >
                <AppIcon name="ban" />
                Esgotados
              </button>
              <button
                type="button"
                class="hidden min-h-12 items-center gap-1.5 rounded-button px-2 font-bold text-primary-deep hover:bg-primary-soft sm:flex"
                data-testid="card-size"
                @click="nextSize"
              >
                <AppIcon name="columns" />
                Tamanho: {{ CARD_SIZE_LABELS[size] }}
              </button>
              <button
                type="button"
                class="flex min-h-12 items-center gap-1.5 rounded-button px-2 font-bold"
                :class="alerts.enabled.value ? 'text-primary-deep' : 'text-text-muted'"
                :aria-pressed="alerts.enabled.value"
                data-testid="alerts-toggle"
                @click="alerts.setEnabled(!alerts.enabled.value)"
              >
                <AppIcon :name="alerts.enabled.value ? 'bell' : 'bell-off'" />
                {{ alerts.enabled.value ? 'Som ligado' : 'Som desligado' }}
              </button>
              <button
                type="button"
                class="flex min-h-12 items-center gap-1.5 rounded-button px-2 font-bold text-primary-deep hover:bg-primary-soft"
                data-testid="fullscreen"
                @click="toggleFullscreen"
              >
                <AppIcon :name="fullscreen.active.value ? 'minimize' : 'maximize'" />
                {{ fullscreen.active.value ? 'Sair da tela cheia' : 'Tela cheia' }}
              </button>
            </div>
          </div>
        </div>
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
        <AppAlert v-if="queue.loadError.value" tone="error">{{ queue.loadError.value }}</AppAlert>
        <AppAlert v-for="notice in queue.looseNotices.value" :key="notice.id" tone="error">
          <p>{{ notice.text }}</p>
          <button
            type="button"
            class="mt-1 min-h-12 font-bold underline"
            @click="
              queue.looseNotices.value = queue.looseNotices.value.filter(
                (item) => item.id !== notice.id,
              )
            "
          >
            Entendi
          </button>
        </AppAlert>

        <p v-if="!queue.loaded.value && !queue.loadError.value" class="text-text-muted">
          Carregando pedidos…
        </p>
        <div
          v-else-if="queue.loaded.value && visibleCards.length === 0"
          class="flex flex-col items-center gap-2 rounded-card border-2 border-dashed border-border-strong p-8 text-center text-text-muted"
          data-testid="queue-empty"
        >
          <AppIcon name="check-circle" :size="32" />
          <template v-if="filter.kind === 'all'">
            <p class="text-lg font-bold">Nenhum pedido agora.</p>
            <p>Os pedidos novos aparecem aqui sozinhos, com som.</p>
          </template>
          <template v-else>
            <p class="text-lg font-bold">Nenhum pedido neste filtro.</p>
            <button
              type="button"
              class="min-h-12 font-bold text-primary-deep underline"
              @click="filter = { kind: 'all' }"
            >
              Ver todos
            </button>
          </template>
        </div>
        <ul
          class="grid grid-cols-1 items-start gap-3 sm:grid-cols-[repeat(auto-fill,minmax(var(--kds-card),1fr))]"
          :style="{ '--kds-card': `${CARD_WIDTHS[size]}px` }"
          aria-live="polite"
          data-testid="kds-grid"
        >
          <li v-for="card in visibleCards" :key="cardKey(card)">
            <StationOrderCard
              :card="card"
              :stages="queue.stages.value"
              :limits="queue.limits.value"
              :now="now"
              :is-new="queue.isNew(card)"
              :stage-filter="stageFilter"
              :line-pending="linePending"
              :pending="cardPending[card.orderId]"
              :notice="queue.notices.value[card.orderId]"
              @touch="queue.touch(card)"
              @advance-line="(line, quantity) => queue.advanceLine(line, quantity)"
              @back-line="queue.backLine"
              @cancel-line="cancelLine"
              @advance-card="queue.advanceCard(card, stageFilter)"
              @back-card="queue.backCard(card)"
              @cancel-card="(reason) => queue.cancelCard(card, reason)"
              @acknowledge="queue.acknowledge(card)"
              @dismiss-notice="queue.dismissNotice(card.orderId)"
            />
          </li>
        </ul>
      </template>
    </OperationShell>

    <div
      v-if="queue.undo.value"
      class="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pb-[env(safe-area-inset-bottom)]"
    >
      <div
        role="status"
        class="flex w-full max-w-md items-center gap-3 rounded-card bg-text px-4 py-2 text-surface"
        data-testid="undo"
      >
        <AppIcon name="check-circle" />
        <span class="flex-1 font-bold">{{ queue.undo.value.text }}</span>
        <button
          type="button"
          class="min-h-12 rounded-button px-3 font-bold underline"
          @click="queue.undoLast()"
        >
          Desfazer
        </button>
      </div>
    </div>

    <AppDialog v-model:open="recentsOpen" title="Recentes">
      <div class="flex flex-col gap-3">
        <p class="text-text-muted">
          Os últimos pedidos que saíram desta estação. Se algum saiu por engano, volte com ele.
        </p>
        <AppAlert v-if="recentNotice">{{ recentNotice }}</AppAlert>
        <p v-if="queue.recents.value.length === 0" class="font-bold">
          Nenhum pedido saiu desta estação desde que a tela abriu.
        </p>
        <ul class="flex flex-col gap-2">
          <li
            v-for="entry in queue.recents.value"
            :key="entry.orderId"
            class="flex flex-col gap-2 rounded-card border-2 border-border bg-surface p-3"
            data-testid="recent"
          >
            <p class="flex items-baseline gap-2">
              <span class="font-display text-xl font-extrabold tabular-nums">{{
                entry.tabNumber
              }}</span>
              <span class="flex-1 truncate font-bold">{{ entry.customerName }}</span>
              <span class="text-sm text-text-muted">{{ minutesAgo(entry.leftAt) }}</span>
            </p>
            <p class="text-sm">
              {{ itemsLabel(entry.lines.reduce((sum, line) => sum + line.quantity, 0)) }}:
              {{ linesSummary(entry.lines) }}
            </p>
            <AppButton variant="secondary" @click="revert(entry)">
              <AppIcon name="undo" />
              Voltar para esta estação
            </AppButton>
          </li>
        </ul>
      </div>
    </AppDialog>

    <AppDialog v-model:open="installHintOpen" title="Tela cheia">
      <div class="flex flex-col gap-3">
        <p>Este navegador não deixa abrir em tela cheia.</p>
        <p>
          Instale o Varal na tela de início (no iPhone: Compartilhar → Adicionar à Tela de Início).
          Aberto pelo ícone, ele já ocupa a tela inteira, sem as barras do navegador.
        </p>
        <AppButton variant="secondary" @click="installHintOpen = false">Entendi</AppButton>
      </div>
    </AppDialog>

    <AppDialog v-if="place" v-model:open="soldOutOpen" title="Esgotados">
      <MenuSoldOutList :unit-id="place.unit.id" />
    </AppDialog>
  </div>
</template>
