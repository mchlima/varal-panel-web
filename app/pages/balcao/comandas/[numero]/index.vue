<script setup lang="ts">
import { formatTime } from '~/lib/datetime'
import { formatCents } from '~/lib/money'
import {
  TAB_STATUS_LABELS,
  changedItemOf,
  itemConflictMessage,
  itemsLabel,
  type ItemChange,
  type OrderItem,
  type Tab,
} from '~/lib/operation'
import { pendingForItem, pendingLabel, pendingOperations } from '~/lib/operation-actions'
import { cartTotalCents, lineTotalCents } from '~/lib/order-builder'

/**
 * Comanda (`/balcao/comandas/{numero}`, spec 04, seção 8.1): pedidos com os itens e a etapa de
 * cada um, "Entregue" nos prontos (RN-04.21), cancelar item com motivo (RN-04.25, RN-04.26),
 * "Novo pedido", "Pedir a conta", "Reabrir" (RN-04.12) e cancelar comanda. Receber é da spec 05.
 * Toda escrita vai pela fila local (spec 01, seção 11); o pendente aparece como "Enviando…" ou
 * "Na fila", sem prever o resultado.
 */
const route = useRoute()
const number = computed(() => Number(route.params.numero))
const { place, counter } = useCounterLive()
const { tab, notFound, error, reloadSoon, applyItem } = useTabDetail(number)
const connection = useConnectionStore()
const operations = useOperations()
const itemActions = useItemActions()
const cart = useCartStore()
const now = useClock(15_000)

useHead({ title: () => `Comanda ${number.value} · Varal` })

const tabId = computed(() => tab.value?.id ?? null)
const { notice: orderNotice } = useOrderFailures(tabId)
const notices = ref<Record<string, string>>({})
const tabError = ref('')

const editable = computed(() => tab.value?.status === 'open' || tab.value?.status === 'closing')
const items = computed<OrderItem[]>(() => tab.value?.orders.flatMap((order) => order.items) ?? [])
const activeItems = computed(() => items.value.filter((item) => item.canceledAt === null))
const draft = computed(() => (tab.value ? cart.cartOf(tab.value.id) : null))

const pendingOrders = computed(() =>
  pendingOperations(
    connection.pending,
    (meta) => meta.kind === 'tab.order' && meta.tabId === tabId.value,
  ).map((op) => ({
    key: op.action.idempotencyKey,
    label: pendingLabel(op.action, connection.online),
    lines: op.meta.kind === 'tab.order' ? op.meta.lines : [],
  })),
)
const pendingTabAction = computed(
  () =>
    pendingOperations(
      connection.pending,
      (meta) =>
        (meta.kind === 'tab.request_bill' ||
          meta.kind === 'tab.reopen' ||
          meta.kind === 'tab.cancel') &&
        meta.tabId === tabId.value,
    )[0] ?? null,
)
const pendingTabText = computed(() => {
  const op = pendingTabAction.value
  if (!op) return ''
  const what =
    op.meta.kind === 'tab.request_bill'
      ? 'Pedindo a conta'
      : op.meta.kind === 'tab.reopen'
        ? 'Reabrindo'
        : 'Cancelando a comanda'
  return `${what}: ${pendingLabel(op.action, connection.online)}`
})

function itemPending(item: OrderItem): string | undefined {
  const op = pendingForItem(connection.pending, item.id)
  if (!op || !('quantity' in op.meta)) return undefined
  return itemPendingText(op.meta, pendingLabel(op.action, connection.online))
}

// Resposta da API a uma ação deste aparelho: aplica na hora (o evento confirma depois).
operations.onSettled((meta, outcome) => {
  if (!tab.value) return
  if ('tabId' in meta && meta.tabId !== tab.value.id) return
  if (meta.kind.startsWith('item.') && outcome.ok) {
    const change = outcome.body as ItemChange | undefined
    applyItem(change?.changed)
    applyItem(change?.remaining)
  }
  if (meta.kind !== 'tab.create') reloadSoon()
})

// CA-04.05: outro aparelho mudou o item antes; o item mostra o estado atual e o aviso.
useOperationFailures((meta, failure) => {
  if (!meta.kind.startsWith('item.') || !('itemId' in meta) || meta.tabId !== tabId.value) {
    return false
  }
  const current = changedItemOf(failure.details)
  const message = itemConflictMessage(failure.code, current)
  if (!message) return false
  applyItem(current)
  reloadSoon()
  notices.value = { ...notices.value, [current?.id ?? meta.itemId]: message }
  return true
})

function dismissNotice(id: string) {
  const { [id]: _done, ...rest } = notices.value
  notices.value = rest
}

function deliver(item: OrderItem) {
  const final = counter.stages.at(-1)
  void itemActions.advance(item, { deliver: true, toStageName: final?.name })
}

function cancelItem(item: OrderItem, value: { quantity: number; reason: string }) {
  void itemActions.cancel(item, value.quantity, value.reason)
}

function tabAction(kind: 'tab.request_bill' | 'tab.reopen' | 'tab.cancel', current: Tab) {
  tabError.value = ''
  const path = {
    'tab.request_bill': 'request-bill',
    'tab.reopen': 'reopen',
    'tab.cancel': 'cancel',
  }[kind]
  const label = {
    'tab.request_bill': 'Pedir a conta',
    'tab.reopen': 'Reabrir',
    'tab.cancel': 'Cancelar',
  }[kind]
  void operations.submit({
    path: `/api/v1/tabs/${current.id}/${path}`,
    body: {},
    label: `${label} da comanda ${current.number} · ${current.customerName}`,
    meta: { kind, tabId: current.id, tabNumber: current.number },
  })
}

function cancelTab(current: Tab) {
  // RN-04.12: só com todos os itens cancelados; a comanda não cancela itens sozinha.
  if (activeItems.value.length > 0) {
    tabError.value = 'Cancele os itens da comanda antes de cancelá-la.'
    return
  }
  tabAction('tab.cancel', current)
}
</script>

<template>
  <OperationShell
    :title="tab ? `${tab.number} · ${tab.customerName}` : `Comanda ${number}`"
    :unit-name="place?.unit.name"
    back="/balcao"
    back-label="Voltar ao varal"
    wide
  >
    <AppAlert v-if="!place">
      Escolha uma estação de balcão liberada para você em "Trocar de estação".
    </AppAlert>
    <template v-else-if="counter.shiftLoaded && !counter.shift">
      <NoShiftNotice :unit-id="place.unit.id" />
    </template>
    <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <aside class="hidden lg:block" aria-label="Outras comandas">
        <TabBoard :selected-number="number" />
      </aside>

      <section class="flex min-w-0 flex-col gap-4" aria-label="Comanda">
        <AppAlert v-if="error && !(tab && !connection.online)" tone="error">{{ error }}</AppAlert>
        <AppAlert v-if="notFound" tone="error">
          A comanda {{ number }} não existe neste turno.
          <NuxtLink to="/balcao" class="font-bold underline">Voltar ao varal</NuxtLink>
        </AppAlert>
        <p v-else-if="!tab" class="text-text-muted">Carregando comanda…</p>

        <template v-if="tab">
          <div class="flex flex-col gap-3 rounded-card border-2 border-border bg-surface p-4">
            <div class="flex items-center gap-3">
              <span class="font-display text-[2.5rem] leading-none font-extrabold tabular-nums">{{
                tab.number
              }}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-lg font-bold">{{ tab.customerName }}</p>
                <p class="text-sm text-text-muted">
                  {{ itemsLabel(tab.itemCount) }} · aberta às {{ formatTime(tab.openedAt) }}
                </p>
              </div>
              <StageChip
                :status="
                  tab.status === 'closing'
                    ? 'closing'
                    : tab.status === 'open'
                      ? 'ready'
                      : 'delivered'
                "
                :label="TAB_STATUS_LABELS[tab.status]"
              />
            </div>
            <dl class="grid grid-cols-2 gap-1 border-t border-border pt-3">
              <dt class="text-text-muted">Subtotal</dt>
              <dd class="text-right tabular-nums">{{ formatCents(tab.subtotalCents) }}</dd>
              <template v-if="tab.discountCents > 0">
                <dt class="text-text-muted">Desconto</dt>
                <dd class="text-right tabular-nums">- {{ formatCents(tab.discountCents) }}</dd>
              </template>
              <dt class="font-bold">Total</dt>
              <dd
                class="text-right font-display text-2xl font-extrabold tabular-nums"
                data-testid="tab-total"
              >
                {{ formatCents(tab.totalCents) }}
              </dd>
            </dl>
            <StageChip v-if="pendingTabText" status="pending" :label="pendingTabText" />
          </div>

          <AppAlert v-if="orderNotice" tone="error">
            <p>{{ orderNotice }}</p>
            <NuxtLink :to="`/balcao/comandas/${tab.number}/pedido`" class="font-bold underline">
              Corrigir pedido
            </NuxtLink>
          </AppAlert>
          <AppAlert v-else-if="draft && draft.lines.length > 0 && tab.status === 'open'">
            <p>
              Pedido em montagem: {{ itemsLabel(draft.lines.length) }} ·
              {{ formatCents(cartTotalCents(draft.lines)) }}.
            </p>
            <NuxtLink :to="`/balcao/comandas/${tab.number}/pedido`" class="font-bold underline">
              Continuar pedido
            </NuxtLink>
          </AppAlert>

          <section
            v-for="pending in pendingOrders"
            :key="pending.key"
            class="flex flex-col gap-2 rounded-card border-2 border-dashed border-border-strong bg-surface-muted p-4"
            data-testid="pending-order"
          >
            <div class="flex items-center gap-2">
              <h2 class="flex-1 text-lg">Pedido novo</h2>
              <StageChip status="pending" :label="pending.label" />
            </div>
            <p class="text-sm text-text-muted">
              Ainda não chegou à cozinha. Vai sozinho quando a conexão permitir, uma vez só.
            </p>
            <ul class="flex flex-col gap-1">
              <li v-for="line in pending.lines" :key="line.key" class="flex gap-2">
                <span class="font-bold tabular-nums">{{ line.quantity }}×</span>
                <span class="flex-1">{{ line.productName }}</span>
                <span class="tabular-nums">{{ formatCents(lineTotalCents(line)) }}</span>
              </li>
            </ul>
          </section>

          <section
            v-for="order in [...tab.orders].reverse()"
            :key="order.id"
            class="rounded-card border-2 border-border bg-surface px-4 py-3"
            :aria-label="`Pedido ${order.numberInTab}`"
            data-testid="tab-order"
          >
            <div class="flex items-center gap-2">
              <h2 class="flex-1 text-lg">Pedido {{ order.numberInTab }}</h2>
              <span class="text-sm text-text-muted">{{ formatTime(order.sentAt) }}</span>
            </div>
            <ul>
              <TabItemRow
                v-for="item in order.items"
                :key="item.id"
                :item="item"
                :stages="counter.stages"
                :now="now"
                :editable="editable"
                :pending="itemPending(item)"
                :notice="notices[item.id]"
                @deliver="deliver(item)"
                @cancel="cancelItem(item, $event)"
                @dismiss-notice="dismissNotice(item.id)"
              />
            </ul>
          </section>
          <p v-if="tab.orders.length === 0 && pendingOrders.length === 0" class="text-text-muted">
            Nenhum pedido ainda.
          </p>

          <div v-if="editable" class="flex flex-col gap-3">
            <AppButton
              v-if="tab.status === 'open'"
              variant="secondary"
              :disabled="!!pendingTabAction"
              data-testid="request-bill"
              @click="tabAction('tab.request_bill', tab)"
            >
              <AppIcon name="receipt" />
              Pedir a conta
            </AppButton>
            <AppButton
              v-if="tab.status === 'closing'"
              variant="secondary"
              disabled
              title="O recebimento chega com o módulo de caixa."
            >
              <AppIcon name="receipt" />
              Receber · disponível em breve
            </AppButton>
            <AppAlert v-if="tabError" tone="error">{{ tabError }}</AppAlert>
            <ConfirmAction
              label="Cancelar comanda"
              :question="`Cancelar a comanda ${tab.number} · ${tab.customerName}?`"
              confirm-label="Cancelar comanda"
              @confirm="cancelTab(tab)"
            >
              <p v-if="activeItems.length > 0" class="text-sm">
                Ainda há {{ itemsLabel(activeItems.length) }} ativos: cancele cada um antes.
              </p>
            </ConfirmAction>
          </div>
        </template>
      </section>
    </div>

    <template v-if="tab && editable" #footer>
      <AppButton
        v-if="tab.status === 'open'"
        :to="`/balcao/comandas/${tab.number}/pedido`"
        data-testid="new-order"
      >
        <AppIcon name="plus" />
        Novo pedido
      </AppButton>
      <AppButton
        v-else
        :disabled="!!pendingTabAction"
        data-testid="reopen"
        @click="tabAction('tab.reopen', tab)"
      >
        <AppIcon name="undo" />
        Reabrir comanda
      </AppButton>
    </template>
  </OperationShell>
</template>
