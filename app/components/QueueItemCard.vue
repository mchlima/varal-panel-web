<script setup lang="ts">
import {
  elapsedLabel,
  isItemLate,
  minutesSince,
  nextStage,
  previousStage,
  stageTone,
  type OrderItem,
  type WorkflowStage,
} from '~/lib/operation'

/**
 * Cartão de item da estação (spec 04, seção 8.2; spec 08, seção 6): chip de status no topo,
 * número e nome da comanda, quantidade e produto em letra grande, modificadores e observação
 * em destaque, tempo desde o pedido, atraso com os minutos (RN-04.23) e o botão de avanço
 * ocupando a largura, com o nome da próxima etapa. Menu secundário: avançar parte (RN-04.24),
 * voltar etapa (RN-04.22) e cancelar com motivo (RN-04.25, RN-04.26).
 */
const props = withDefaults(
  defineProps<{
    item: OrderItem
    stages: readonly WorkflowStage[]
    now: number
    fresh?: boolean
    pending?: string
    notice?: string
  }>(),
  { fresh: false, pending: undefined, notice: undefined },
)
const emit = defineEmits<{
  advance: [quantity: number]
  back: []
  cancel: [value: { quantity: number; reason: string }]
  seen: []
  dismissNotice: []
}>()

const menuOpen = ref(false)
const mode = ref<'menu' | 'partial' | 'cancel'>('menu')
const next = computed(() => nextStage(props.stages, props.item.stageId))
const previous = computed(() => previousStage(props.stages, props.item.stageId))
const late = computed(() => isItemLate(props.item, props.now))
const tone = computed(() => stageTone(props.stages, props.item))
const advanceLabel = computed(() => next.value?.name ?? 'Avançar')
const wasteHint = computed(() => previous.value !== null)

function openMenu() {
  emit('seen')
  mode.value = 'menu'
  menuOpen.value = !menuOpen.value
}

function advance(quantity: number) {
  menuOpen.value = false
  emit('advance', quantity)
}

function back() {
  menuOpen.value = false
  emit('back')
}

function cancel(value: { quantity: number; reason: string }) {
  menuOpen.value = false
  emit('cancel', value)
}
</script>

<template>
  <article
    class="flex flex-col gap-2 rounded-card border-2 bg-surface p-3"
    :class="fresh ? 'border-primary ring-4 ring-primary-soft' : 'border-border'"
    :aria-label="`${item.quantity} ${item.productName}, comanda ${item.tabNumber} ${item.customerName}`"
    data-testid="queue-item"
    :data-item-id="item.id"
    :data-stage="item.stageName"
    :data-quantity="item.quantity"
    @pointerdown="fresh && emit('seen')"
  >
    <div class="flex flex-wrap items-center gap-1.5">
      <StageChip v-if="fresh" status="new" label="Novo" />
      <StageChip :status="tone" :label="item.stageName" />
      <StageChip
        v-if="late"
        status="late"
        :label="`Atrasado · ${minutesSince(item.sentAt, now)} min`"
      />
      <StageChip v-if="pending" status="pending" :label="pending" />
      <span class="ml-auto inline-flex items-center gap-1 text-sm text-text-muted">
        <AppIcon name="clock" :size="14" />
        {{ elapsedLabel(item.sentAt, now) }}
      </span>
    </div>

    <p class="flex items-baseline gap-2 text-text-muted">
      <span class="font-display text-xl font-extrabold text-text tabular-nums">{{
        item.tabNumber
      }}</span>
      <span class="truncate font-bold text-text">{{ item.customerName }}</span>
      <span class="ml-auto text-sm whitespace-nowrap">Pedido {{ item.orderNumberInTab }}</span>
    </p>

    <p class="text-lg leading-snug font-extrabold" data-testid="queue-item-title">
      <span class="font-display text-2xl tabular-nums">{{ item.quantity }}×</span>
      {{ item.productName }}
    </p>
    <ul v-if="item.modifiers.length" class="flex flex-wrap gap-1.5">
      <li
        v-for="modifier in item.modifiers"
        :key="modifier.modifierId"
        class="rounded-chip border border-border-strong px-2 py-0.5 font-bold"
      >
        {{ modifier.modifierName }}
      </li>
    </ul>
    <p
      v-if="item.note"
      class="rounded-chip bg-status-preparing-bg px-3 py-2 font-bold text-status-preparing-text"
    >
      Obs.: {{ item.note }}
    </p>

    <AppAlert v-if="notice" tone="error">
      <p>{{ notice }}</p>
      <button
        type="button"
        class="mt-1 min-h-12 font-bold underline"
        @click="emit('dismissNotice')"
      >
        Entendi
      </button>
    </AppAlert>

    <div class="flex gap-2">
      <button
        v-if="next"
        type="button"
        class="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-button border-2 border-primary bg-surface px-4 text-lg font-bold text-primary-deep hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!!pending"
        data-testid="advance"
        @click="(emit('seen'), advance(item.quantity))"
      >
        <AppIcon name="arrow-right" />
        {{ advanceLabel }}
      </button>
      <button
        type="button"
        class="flex size-14 shrink-0 items-center justify-center rounded-button border-2 border-border-strong bg-surface disabled:opacity-50"
        :aria-expanded="menuOpen"
        :disabled="!!pending"
        aria-label="Mais ações"
        data-testid="item-menu"
        @click="openMenu"
      >
        <AppIcon name="more" :size="24" />
      </button>
    </div>

    <div v-if="menuOpen && !pending" class="flex flex-col gap-2 border-t border-border pt-2">
      <template v-if="mode === 'menu'">
        <button
          v-if="next && item.quantity > 1"
          type="button"
          class="flex min-h-12 items-center gap-2 rounded-button px-2 font-bold text-primary-deep hover:bg-primary-soft"
          data-testid="advance-part"
          @click="mode = 'partial'"
        >
          <AppIcon name="arrow-right" />
          Avançar parte para {{ next.name }}
        </button>
        <button
          v-if="previous"
          type="button"
          class="flex min-h-12 items-center gap-2 rounded-button px-2 font-bold text-primary-deep hover:bg-primary-soft"
          data-testid="back"
          @click="back"
        >
          <AppIcon name="undo" />
          Voltar para {{ previous.name }}
        </button>
        <button
          type="button"
          class="flex min-h-12 items-center gap-2 rounded-button px-2 font-bold text-status-late-text hover:bg-status-late-bg"
          @click="mode = 'cancel'"
        >
          <AppIcon name="x" />
          Cancelar item
        </button>
      </template>

      <fieldset v-else-if="mode === 'partial' && next" class="flex flex-col gap-2">
        <legend class="mb-1 font-bold">Quantos seguem para {{ next.name }}?</legend>
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="amount in item.quantity"
            :key="amount"
            type="button"
            class="min-h-13 rounded-button border-2 font-display text-xl font-extrabold tabular-nums"
            :class="
              amount === item.quantity
                ? 'border-primary text-primary-deep'
                : 'border-border-strong text-text'
            "
            :aria-label="
              amount === item.quantity ? `Todos os ${amount}` : `${amount} de ${item.quantity}`
            "
            :data-testid="`advance-${amount}`"
            @click="advance(amount)"
          >
            {{ amount }}
          </button>
        </div>
        <p class="text-sm text-text-muted">
          O resto fica em {{ item.stageName }} e vira uma linha à parte.
        </p>
        <button
          type="button"
          class="min-h-12 self-start font-bold underline"
          @click="mode = 'menu'"
        >
          Voltar
        </button>
      </fieldset>

      <CancelItemForm
        v-else-if="mode === 'cancel'"
        :quantity="item.quantity"
        :product-name="item.productName"
        :waste-hint="wasteHint"
        @submit="cancel"
        @close="mode = 'menu'"
      />
    </div>
  </article>
</template>
