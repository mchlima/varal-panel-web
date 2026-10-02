<script setup lang="ts">
import { formatTime } from '~/lib/datetime'
import {
  REASON_MAX,
  clockLabel,
  minutesSince,
  nextStage,
  previousStage,
  stageTone,
  type StationLine,
  type WorkflowStage,
} from '~/lib/operation'
import {
  advanceLabel,
  cardLevel,
  linesToAdvance,
  pendingLines,
  type StationCard,
  type StationLimits,
} from '~/lib/station'

/**
 * Cartão do pedido na estação (spec 04, seção 8.2; spec 08, seção 6): um pedido, um cartão,
 * nunca um por item (RN-04.40). Cabeçalho na cor de status: "Novo" até ser tocado; depois o nível
 * de tempo (RN-04.46), sempre com texto e ícone (CA-08.03, CA-08.06). Tocar numa linha avança só
 * ela (RN-04.41); o botão do rodapé avança o pedido inteiro (RN-04.39); linhas feitas e
 * canceladas ficam riscadas até o cartão sair (RN-04.41, RN-04.45).
 */
const props = withDefaults(
  defineProps<{
    card: StationCard
    stages: readonly WorkflowStage[]
    limits: StationLimits
    now: number
    isNew?: boolean
    /** Filtro por etapa ativo: o botão avança só as linhas dessa etapa (RN-04.39). */
    stageFilter?: string | null
    /** Ação pendente por linha ("Pronto: Na fila"). */
    linePending?: Record<string, string>
    /** Avanço do pedido inteiro pendente. */
    pending?: string
    notice?: string
  }>(),
  {
    isNew: false,
    stageFilter: null,
    linePending: () => ({}),
    pending: undefined,
    notice: undefined,
  },
)
const emit = defineEmits<{
  touch: []
  advanceLine: [line: StationLine, quantity: number]
  backLine: [line: StationLine]
  cancelLine: [line: StationLine, value: { quantity: number; reason: string }]
  advanceCard: []
  backCard: []
  cancelCard: [reason: string]
  acknowledge: []
  dismissNotice: []
}>()

const level = computed(() => cardLevel(props.card, props.limits, props.now))
const toAdvance = computed(() => linesToAdvance(props.card, props.stageFilter))
const buttonLabel = computed(() => advanceLabel(toAdvance.value, props.stages))
const busy = computed(
  () => !!props.pending || toAdvance.value.some((line) => line.id in props.linePending),
)
const canceledOut = computed(() => props.card.ackRequired)

/** Cabeçalho: cor e texto do status (spec 08, seção 4). */
const header = computed(() => {
  if (canceledOut.value) {
    return {
      class: 'bg-status-canceled-bg text-status-canceled-text',
      icon: 'x' as const,
      label: 'Cancelado',
    }
  }
  if (level.value === 'late') {
    return {
      class: 'bg-status-late-bg text-status-late-text',
      icon: 'alert-circle' as const,
      label: `Atrasado · ${minutesSince(props.card.sentAt, props.now)} min`,
    }
  }
  if (level.value === 'attention') {
    return {
      class: 'bg-status-attention-bg text-status-attention-ink',
      icon: 'hourglass' as const,
      label: 'Atenção',
    }
  }
  if (props.isNew) {
    return { class: 'bg-status-new-bg text-status-new-text', icon: 'dot' as const, label: 'Novo' }
  }
  return { class: 'bg-surface-muted text-text', icon: 'clock' as const, label: 'No prazo' }
})

const openLine = ref<string | null>(null)
const lineMode = ref<'menu' | 'partial' | 'cancel'>('menu')
const cardMenu = ref<'closed' | 'menu' | 'cancel'>('closed')
const cancelReason = ref('')
const cancelTried = ref(false)

function touch() {
  emit('touch')
}

function tapLine(line: StationLine) {
  touch()
  if (line.state !== 'pending' || line.id in props.linePending) return
  emit('advanceLine', line, line.quantity)
}

function toggleLineMenu(line: StationLine) {
  touch()
  lineMode.value = 'menu'
  openLine.value = openLine.value === line.id ? null : line.id
}

function lineAction(fn: () => void) {
  fn()
  openLine.value = null
}

function submitCardCancel() {
  cancelTried.value = true
  const reason = cancelReason.value.trim()
  if (!reason) return
  emit('cancelCard', reason.slice(0, REASON_MAX))
  cardMenu.value = 'closed'
  cancelReason.value = ''
  cancelTried.value = false
}

const pendingCount = computed(() => pendingLines(props.card).length)
const otherLabel = computed(() => {
  const n = props.card.otherStationsQuantity
  return n === 1 ? '+ 1 item em outra estação' : `+ ${n} itens em outra estação`
})
</script>

<template>
  <article
    class="flex flex-col overflow-hidden rounded-card border-2 bg-surface"
    :class="
      canceledOut
        ? 'border-status-canceled-text'
        : isNew
          ? 'border-primary ring-4 ring-primary-soft'
          : 'border-border-strong'
    "
    :aria-label="`Comanda ${card.tabNumber} · ${card.customerName}`"
    data-testid="order-card"
    :data-order-id="card.orderId"
    :data-level="level"
    @pointerdown="touch"
  >
    <header class="flex flex-col gap-1 px-3 py-2" :class="header.class" data-testid="card-header">
      <div class="flex items-baseline gap-2">
        <span class="font-display text-2xl leading-none font-extrabold tabular-nums">{{
          card.tabNumber
        }}</span>
        <span class="min-w-0 flex-1 truncate text-lg font-bold">{{ card.customerName }}</span>
        <span class="font-display text-xl font-extrabold tabular-nums" data-testid="card-clock">{{
          clockLabel(card.sentAt, now)
        }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold">
        <span class="inline-flex items-center gap-1" data-testid="card-status">
          <AppIcon :name="header.icon" :size="16" />
          {{ header.label }}
        </span>
        <StageChip v-if="isNew && !canceledOut && level !== 'normal'" status="new" label="Novo" />
        <span v-if="card.isAdditional" class="rounded-chip border border-current px-1.5">
          Adicional · pedido {{ card.numberInTab }}
        </span>
        <span v-if="card.tabMode === 'pay_first'" class="rounded-chip border border-current px-1.5">
          Paga antes
        </span>
        <span class="ml-auto font-normal">enviado {{ formatTime(card.sentAt) }}</span>
      </div>
    </header>

    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="line in card.lines"
        :key="line.id"
        data-testid="card-line"
        :data-state="line.state"
      >
        <div class="flex items-stretch">
          <button
            type="button"
            class="flex min-h-14 min-w-0 flex-1 flex-col items-start gap-1 px-3 py-2 text-left"
            :class="line.state === 'pending' ? 'hover:bg-primary-soft' : 'cursor-default'"
            :disabled="line.state !== 'pending' || line.id in linePending"
            :aria-label="
              line.state === 'pending'
                ? `${line.quantity} ${line.productName}: tocar para ${nextStage(stages, line.stageId)?.name ?? 'avançar'}`
                : undefined
            "
            data-testid="line-advance"
            @click="tapLine(line)"
          >
            <span
              class="flex w-full items-start gap-2 text-lg leading-snug font-bold"
              :class="line.state !== 'pending' ? 'text-text-muted line-through' : ''"
            >
              <AppIcon
                v-if="line.state === 'done'"
                name="check-circle"
                class="mt-1 text-status-ready-text"
                label="Feito"
              />
              <span class="tabular-nums">{{ line.quantity }}×</span>
              <span class="min-w-0 flex-1">{{ line.productName }}</span>
            </span>
            <ul
              v-if="line.modifiers.length"
              class="flex flex-col pl-7 font-bold"
              :class="line.state !== 'pending' ? 'text-text-muted line-through' : ''"
            >
              <li v-for="modifier in line.modifiers" :key="modifier.modifierId">
                {{ modifier.modifierName }}
              </li>
            </ul>
            <p
              v-if="line.note"
              class="flex w-full items-start gap-1.5 rounded-chip bg-primary-soft px-2 py-1 font-bold text-primary-deep"
            >
              <AppIcon name="message" :size="16" class="mt-0.5" />
              <span>Obs.: {{ line.note }}</span>
            </p>
            <span class="flex flex-wrap items-center gap-1.5">
              <StageChip
                v-if="line.state === 'canceled'"
                status="canceled"
                label="Cancelado"
                data-testid="line-canceled"
              />
              <StageChip
                v-else-if="line.state === 'done'"
                status="ready"
                :label="`Feito · ${line.stageName}`"
              />
              <StageChip v-else :status="stageTone(stages, line)" :label="line.stageName" />
              <StageChip
                v-if="linePending[line.id]"
                status="pending"
                :label="linePending[line.id]!"
              />
            </span>
            <span
              v-if="line.state === 'canceled' && line.cancelReason"
              class="text-sm font-bold text-status-late-text"
              >Motivo: {{ line.cancelReason }}</span
            >
          </button>
          <button
            v-if="line.state === 'pending'"
            type="button"
            class="flex w-12 shrink-0 items-center justify-center border-l border-border text-text hover:bg-surface-muted disabled:opacity-50"
            :aria-expanded="openLine === line.id"
            :aria-label="`Mais ações: ${line.productName}`"
            :disabled="line.id in linePending"
            data-testid="line-menu"
            @click="toggleLineMenu(line)"
          >
            <AppIcon name="more" :size="24" />
          </button>
        </div>

        <div
          v-if="openLine === line.id && line.state === 'pending'"
          class="flex flex-col gap-2 bg-surface-muted px-3 py-2"
        >
          <template v-if="lineMode === 'menu'">
            <button
              v-if="line.quantity > 1 && nextStage(stages, line.stageId)"
              type="button"
              class="flex min-h-12 items-center gap-2 rounded-button px-2 font-bold text-primary-deep hover:bg-primary-soft"
              data-testid="advance-part"
              @click="lineMode = 'partial'"
            >
              <AppIcon name="arrow-right" />
              Avançar só parte
            </button>
            <button
              v-if="previousStage(stages, line.stageId)"
              type="button"
              class="flex min-h-12 items-center gap-2 rounded-button px-2 font-bold text-primary-deep hover:bg-primary-soft"
              data-testid="line-back"
              @click="lineAction(() => emit('backLine', line))"
            >
              <AppIcon name="undo" />
              Voltar para {{ previousStage(stages, line.stageId)!.name }}
            </button>
            <button
              type="button"
              class="flex min-h-12 items-center gap-2 rounded-button px-2 font-bold text-status-late-text hover:bg-status-late-bg"
              data-testid="line-cancel"
              @click="lineMode = 'cancel'"
            >
              <AppIcon name="x" />
              Cancelar item
            </button>
          </template>
          <fieldset v-else-if="lineMode === 'partial'" class="flex flex-col gap-2">
            <legend class="mb-1 font-bold">
              Quantos seguem para {{ nextStage(stages, line.stageId)?.name }}?
            </legend>
            <div class="grid grid-cols-4 gap-2">
              <button
                v-for="amount in line.quantity"
                :key="amount"
                type="button"
                class="min-h-12 rounded-button border-2 bg-surface font-display text-xl font-extrabold tabular-nums"
                :class="
                  amount === line.quantity
                    ? 'border-primary text-primary-deep'
                    : 'border-border-strong text-text'
                "
                :aria-label="
                  amount === line.quantity ? `Todos os ${amount}` : `${amount} de ${line.quantity}`
                "
                :data-testid="`advance-${amount}`"
                @click="lineAction(() => emit('advanceLine', line, amount))"
              >
                {{ amount }}
              </button>
            </div>
            <p class="text-sm text-text-muted">
              O resto fica em {{ line.stageName }} e vira uma linha à parte.
            </p>
          </fieldset>
          <CancelItemForm
            v-else
            :quantity="line.quantity"
            :product-name="line.productName"
            :waste-hint="previousStage(stages, line.stageId) !== null"
            @submit="(value) => lineAction(() => emit('cancelLine', line, value))"
            @close="lineMode = 'menu'"
          />
        </div>
      </li>
    </ul>

    <p
      v-if="card.otherStationsQuantity > 0"
      class="px-3 pt-2 text-sm text-text-muted"
      data-testid="other-stations"
    >
      {{ otherLabel }}
    </p>

    <AppAlert v-if="notice" tone="error" class="m-3 mb-0">
      <p>{{ notice }}</p>
      <button
        type="button"
        class="mt-1 min-h-12 font-bold underline"
        @click="emit('dismissNotice')"
      >
        Entendi
      </button>
    </AppAlert>

    <footer class="flex flex-col gap-2 p-3">
      <template v-if="canceledOut">
        <p class="text-sm font-bold">Todos os itens deste pedido foram cancelados.</p>
        <button
          type="button"
          class="flex min-h-14 w-full items-center justify-center gap-2 rounded-button border-2 border-status-canceled-text bg-surface px-4 text-lg font-bold text-status-canceled-text"
          data-testid="acknowledge"
          @click="emit('acknowledge')"
        >
          <AppIcon name="check" />
          Ciente
        </button>
      </template>
      <template v-else-if="pendingCount > 0">
        <div class="flex gap-2">
          <button
            type="button"
            class="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-button border-2 border-primary bg-surface px-4 text-lg font-bold text-primary-deep hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="busy || toAdvance.length === 0"
            data-testid="advance-card"
            @click="(touch(), emit('advanceCard'))"
          >
            <AppIcon name="arrow-right" />
            {{ buttonLabel }}
          </button>
          <button
            type="button"
            class="flex size-14 shrink-0 items-center justify-center rounded-button border-2 border-border-strong bg-surface disabled:opacity-50"
            :aria-expanded="cardMenu !== 'closed'"
            aria-label="Mais ações do pedido"
            :disabled="busy"
            data-testid="card-menu"
            @click="(touch(), (cardMenu = cardMenu === 'closed' ? 'menu' : 'closed'))"
          >
            <AppIcon name="more" :size="24" />
          </button>
        </div>
        <StageChip v-if="pending" status="pending" :label="pending" class="self-start" />
        <div v-if="cardMenu === 'menu'" class="flex flex-col gap-1 border-t border-border pt-2">
          <button
            type="button"
            class="flex min-h-12 items-center gap-2 rounded-button px-2 font-bold text-primary-deep hover:bg-primary-soft"
            data-testid="card-back"
            @click="((cardMenu = 'closed'), emit('backCard'))"
          >
            <AppIcon name="undo" />
            Voltar uma etapa
          </button>
          <button
            type="button"
            class="flex min-h-12 items-center gap-2 rounded-button px-2 font-bold text-status-late-text hover:bg-status-late-bg"
            data-testid="card-cancel"
            @click="cardMenu = 'cancel'"
          >
            <AppIcon name="x" />
            Cancelar o pedido
          </button>
        </div>
        <form
          v-else-if="cardMenu === 'cancel'"
          class="flex flex-col gap-3 rounded-card border-2 border-status-late-text bg-status-late-bg p-3 text-status-late-text"
          novalidate
          @submit.prevent="submitCardCancel"
        >
          <p class="font-bold">Cancelar todos os itens deste pedido aqui?</p>
          <div class="text-text">
            <AppTextField
              v-model="cancelReason"
              label="Motivo"
              :maxlength="REASON_MAX"
              :error="cancelTried && !cancelReason.trim() ? 'Diga o motivo do cancelamento.' : ''"
              placeholder="Ex.: cliente desistiu"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="submit"
              class="min-h-12 rounded-button border-2 border-status-late-text bg-surface px-4 font-bold"
            >
              Cancelar pedido
            </button>
            <button
              type="button"
              class="min-h-12 rounded-button px-4 font-bold underline"
              @click="cardMenu = 'menu'"
            >
              Voltar
            </button>
          </div>
        </form>
      </template>
    </footer>
  </article>
</template>
