<script setup lang="ts">
import { pendingLabel, pendingOperations } from '~/lib/operation-actions'
import type { TabSummary } from '~/lib/operation'

/**
 * Varal de comandas (spec 04, seção 8.1): abas Abertas e Fechando com contadores, busca por
 * número ou nome e os cartões. Comandas abertas sem conexão aparecem como "Na fila" até a API
 * dar o número (spec 01, seção 11: nada é previsto).
 */
withDefaults(defineProps<{ selectedNumber?: number | null }>(), { selectedNumber: null })

const counter = useCounterStore()
const connection = useConnectionStore()
const view = ref<'open' | 'closing'>('open')
const search = ref('')

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

const counts = computed(() => ({
  open: counter.tabs.filter((tab) => tab.status === 'open').length,
  closing: counter.tabs.filter((tab) => tab.status === 'closing').length,
}))

/** Com busca, procura nas duas abas: o número ou o nome que o cliente disse. */
const visible = computed<TabSummary[]>(() => {
  const query = normalize(search.value)
  if (!query) return counter.tabs.filter((tab) => tab.status === view.value)
  if (/^\d+$/.test(query)) {
    return counter.tabs.filter((tab) => String(tab.number).startsWith(query))
  }
  return counter.tabs.filter((tab) => normalize(tab.customerName).includes(query))
})

const queuedTabs = computed(() =>
  pendingOperations(connection.pending, (meta) => meta.kind === 'tab.create').map((op) => ({
    key: op.action.idempotencyKey,
    name: op.meta.kind === 'tab.create' ? op.meta.customerName : '',
    label: pendingLabel(op.action, connection.online),
  })),
)

/** Ação pendente por comanda ("Pedido na fila", "Pedindo a conta…"). */
const pendingByTab = computed(() => {
  const result: Record<string, string> = {}
  for (const op of pendingOperations(connection.pending, (meta) => meta.kind.startsWith('tab.'))) {
    if (op.meta.kind === 'tab.create') continue
    const status = pendingLabel(op.action, connection.online)
    const what =
      op.meta.kind === 'tab.order'
        ? 'Pedido'
        : op.meta.kind === 'tab.request_bill'
          ? 'Conta'
          : op.meta.kind === 'tab.reopen'
            ? 'Reabrir'
            : 'Cancelar'
    result[op.meta.tabId] = `${what}: ${status}`
  }
  return result
})
</script>

<template>
  <section aria-label="Varal de comandas" class="flex flex-col gap-3">
    <div role="group" aria-label="Situação das comandas" class="grid grid-cols-2 gap-2">
      <button
        v-for="option in [
          { value: 'open', label: 'Abertas', count: counts.open },
          { value: 'closing', label: 'Fechando', count: counts.closing },
        ] as const"
        :key="option.value"
        type="button"
        :aria-pressed="view === option.value && !search"
        class="flex min-h-12 items-center justify-center gap-2 rounded-button border-2 px-3 font-bold"
        :class="
          view === option.value && !search
            ? 'border-primary bg-primary-soft text-primary-deep'
            : 'border-border-strong bg-surface text-text'
        "
        @click="((view = option.value), (search = ''))"
      >
        {{ option.label }}
        <span class="rounded-chip bg-surface px-2 text-sm tabular-nums">{{ option.count }}</span>
      </button>
    </div>

    <label class="relative block">
      <span class="sr-only">Buscar comanda por número ou nome</span>
      <AppIcon
        name="search"
        class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted"
      />
      <input
        v-model="search"
        type="search"
        inputmode="search"
        placeholder="Buscar por número ou nome"
        class="min-h-12 w-full rounded-button border-2 border-border-strong bg-surface pr-4 pl-11 text-base"
        data-testid="tab-search"
      />
    </label>

    <ul class="flex flex-col gap-2">
      <li v-for="queued in queuedTabs" :key="queued.key">
        <div
          class="flex min-h-20 items-center gap-3 rounded-card border-2 border-dashed border-border-strong bg-surface-muted py-2 pr-3 pl-2"
          data-testid="queued-tab"
        >
          <span class="flex min-w-14 justify-center text-text-muted" aria-hidden="true">
            <AppIcon name="refresh" :size="24" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="truncate text-lg font-bold">{{ queued.name }}</span>
            <span class="text-sm text-text-muted">O número sai quando a API receber.</span>
          </span>
          <StageChip status="pending" :label="queued.label" />
        </div>
      </li>
      <li v-for="tab in visible" :key="tab.id">
        <TabCard
          :tab="tab"
          :selected="tab.number === selectedNumber"
          :pending="pendingByTab[tab.id]"
        />
      </li>
    </ul>
    <p v-if="visible.length === 0 && queuedTabs.length === 0" class="text-text-muted">
      <template v-if="search">Nenhuma comanda com "{{ search }}".</template>
      <template v-else-if="view === 'open'"
        >Nenhuma comanda aberta. Toque em "Nova comanda".</template
      >
      <template v-else>Nenhuma comanda pedindo a conta.</template>
    </p>
  </section>
</template>
