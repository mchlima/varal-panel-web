<script setup lang="ts">
import { formatCents } from '~/lib/money'
import {
  NOTE_MAX,
  QUANTITY_MAX,
  itemsLabel,
  rejectionMessage,
  rejectionsOf,
  tabLabel,
} from '~/lib/operation'
import {
  cartIssue,
  cartTotalCents,
  cartUnits,
  effectivePriceCents,
  lineTotalCents,
  needsOptions,
  rejectionsByLine,
  toOrderBody,
  unavailableLines,
  buildLine,
  type MenuProduct,
} from '~/lib/order-builder'

/**
 * Montar pedido (`/balcao/comandas/{numero}/pedido`, spec 04, seção 8.1): categorias em abas,
 * busca, produtos em botões grandes com o preço do turno quando houver (RN-04.06), esgotados
 * visíveis e bloqueados (RN-03.10, CA-03.05), folha de opções (RN-03.13), carrinho com
 * quantidades e total, revisão e envio. O envio vai pela fila local (spec 01, seção 11): com
 * rede, a tela espera a resposta e trata `ORDER_REJECTED` apontando os itens (RN-04.17,
 * CA-04.06); sem rede, o pedido fica "Na fila" na comanda e vai uma vez só (CA-01.07).
 */
const route = useRoute()
const number = computed(() => Number(route.params.numero))
const { place, counter } = useCounterLive()
const menu = useMenuStore()
const cart = useCartStore()
const operations = useOperations()
const connection = useConnectionStore()

useHead({ title: () => `Pedido · comanda ${number.value} · Varal` })

const tab = computed(() => counter.tabByNumber(number.value))
const tabId = computed(() => tab.value?.id ?? null)
const { notice: failureNotice } = useOrderFailures(tabId)
const current = computed(() =>
  tab.value ? cart.cartOf(tab.value.id) : { lines: [], rejections: {} },
)
const shiftPrices = computed(() => counter.shift?.prices ?? [])

// Cardápio da unidade, com esgotados em tempo real (CA-03.05) e recarga na reconexão.
watch(
  () => place.value?.unit.id,
  (id) => {
    if (id && menu.unitId !== id) void menu.load(id)
    else if (id && !menu.menu) void menu.load(id)
  },
  { immediate: true },
)
useRealtimeResync(async () => {
  if (place.value) await menu.load(place.value.unit.id)
})
useRealtimeEvent('product.sold_out_changed', menu.applySoldOut)
useRealtimeEvent('menu.updated', menu.applyMenuUpdated)

/** RN-03.10: categorias e produtos inativos não aparecem no balcão. */
const categories = computed(() =>
  [...menu.categories]
    .filter((category) => category.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      ...category,
      products: [...category.products]
        .filter((product) => product.active)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .filter((category) => category.products.length > 0),
)
const categoryId = ref<string | null>(null)
const search = ref('')
watchEffect(() => {
  if (!categories.value.some((category) => category.id === categoryId.value)) {
    categoryId.value = categories.value[0]?.id ?? null
  }
})

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

const products = computed<MenuProduct[]>(() => {
  const query = normalize(search.value)
  if (query) {
    return categories.value
      .flatMap((category) => category.products)
      .filter((product) => normalize(product.name).includes(query))
  }
  return categories.value.find((category) => category.id === categoryId.value)?.products ?? []
})

function availableProduct(id: string) {
  for (const category of categories.value) {
    const product = category.products.find((item) => item.id === id)
    if (product) return product
  }
  return null
}

const inCart = computed(() => {
  const result: Record<string, number> = {}
  for (const line of current.value.lines) {
    result[line.productId] = (result[line.productId] ?? 0) + line.quantity
  }
  return result
})
const unavailable = computed(() => new Set(unavailableLines(current.value.lines, availableProduct)))
const total = computed(() => cartTotalCents(current.value.lines))
const units = computed(() => cartUnits(current.value.lines))

const optionsFor = ref<MenuProduct | null>(null)
const optionsOpen = computed({
  get: () => optionsFor.value !== null,
  set: (open: boolean) => {
    if (!open) optionsFor.value = null
  },
})
const reviewOpen = ref(false)
const lastAdded = ref('')
const sending = ref(false)
const sendError = ref('')
const editingNote = ref<string | null>(null)
const noteDraft = ref('')

function choose(product: MenuProduct) {
  if (!tab.value || product.soldOut) return
  if (needsOptions(product)) {
    optionsFor.value = product
    return
  }
  cart.add(
    tab.value.id,
    buildLine({ product, shiftPrices: shiftPrices.value, modifiers: [], quantity: 1, note: '' }),
  )
  lastAdded.value = `${product.name} adicionado.`
}

function addLine(line: Parameters<typeof cart.add>[1]) {
  if (!tab.value) return
  cart.add(tab.value.id, line)
  lastAdded.value = `${line.quantity} ${line.productName} adicionado.`
  optionsFor.value = null
}

function startNote(key: string, note: string) {
  editingNote.value = key
  noteDraft.value = note
}

function saveNote(key: string) {
  if (tab.value) cart.setNote(tab.value.id, key, noteDraft.value)
  editingNote.value = null
}

function lineProblems(key: string): string[] {
  const problems: string[] = []
  if (unavailable.value.has(key))
    problems.push('Esgotado ou fora do cardápio agora: tire do pedido.')
  for (const rejection of current.value.rejections[key] ?? []) {
    const line = current.value.lines.find((item) => item.key === key)
    const group = line?.modifiers.find((modifier) => modifier.groupId === rejection.modifierGroupId)
    const groupName =
      group?.groupName ??
      availableProduct(rejection.productId)?.modifierGroups.find(
        (g) => g.id === rejection.modifierGroupId,
      )?.name
    const message = rejectionMessage(rejection.reason, groupName)
    if (!problems.includes(message)) problems.push(message)
  }
  return problems
}

const blocking = computed(() => {
  const issue = cartIssue(current.value.lines)
  if (issue) return issue
  if (unavailable.value.size > 0) return 'Tire do pedido os itens esgotados para enviar.'
  return null
})

/** Com rede a resposta chega rápido; passado isso, o pedido segue na fila e a tela volta. */
const WAIT_FOR_ORDER_MS = 2_500

async function send() {
  const target = tab.value
  if (!target || blocking.value || sending.value) return
  sending.value = true
  sendError.value = ''
  const lines = current.value.lines
  try {
    const { settled } = await operations.submit({
      path: `/api/v1/tabs/${target.id}/orders`,
      body: toOrderBody(lines),
      label: `Pedido da comanda ${tabLabel(target)} (${itemsLabel(lines.length)})`,
      meta: { kind: 'tab.order', tabId: target.id, tabNumber: target.number, lines },
    })
    // A partir daqui o pedido é da fila: o carrinho esvazia e, se for recusado, as linhas voltam.
    cart.clear(target.id)
    const outcome = connection.online
      ? await Promise.race([
          settled,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_FOR_ORDER_MS)),
        ])
      : null
    if (outcome && !outcome.ok) {
      // useOrderFailures devolve as linhas ao carrinho; aqui só mantém a revisão aberta.
      if (outcome.error.code === 'ORDER_REJECTED') {
        cart.setRejections(target.id, rejectionsByLine(lines, rejectionsOf(outcome.error.details)))
      }
      sendError.value = outcome.error.message
      return
    }
    reviewOpen.value = false
    await navigateTo(`/balcao/comandas/${target.number}`)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div>
    <OperationShell
      :title="tab ? `Pedido · ${tabLabel(tab)}` : `Pedido · comanda ${number}`"
      :unit-name="place?.unit.name"
      :back="`/balcao/comandas/${number}`"
      back-label="Voltar à comanda"
      wide
    >
      <AppAlert v-if="!place">
        Escolha uma estação de balcão liberada para você em "Trocar de estação".
      </AppAlert>
      <template v-else-if="counter.shiftLoaded && !counter.shift">
        <NoShiftNotice :unit-id="place.unit.id" />
      </template>
      <p v-else-if="!tab && counter.loading" class="text-text-muted">Carregando…</p>
      <AppAlert v-else-if="!tab" tone="error">
        A comanda {{ number }} não está aberta neste turno.
        <NuxtLink to="/balcao" class="font-bold underline">Voltar ao varal</NuxtLink>
      </AppAlert>
      <template v-else>
        <AppAlert v-if="tab.status !== 'open'">
          Esta comanda está pedindo a conta. Reabra a comanda para lançar pedidos.
          <NuxtLink :to="`/balcao/comandas/${tab.number}`" class="font-bold underline">
            Ver comanda
          </NuxtLink>
        </AppAlert>
        <AppAlert v-if="failureNotice" tone="error">{{ failureNotice }}</AppAlert>
        <AppAlert v-if="menu.loadError" tone="error">{{ menu.loadError }}</AppAlert>

        <label class="relative block">
          <span class="sr-only">Buscar produto</span>
          <AppIcon
            name="search"
            class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted"
          />
          <input
            v-model="search"
            type="search"
            placeholder="Buscar produto"
            class="min-h-12 w-full rounded-button border-2 border-border-strong bg-surface pr-4 pl-11 text-base"
            data-testid="product-search"
          />
        </label>

        <div
          v-if="!search"
          role="tablist"
          aria-label="Categorias"
          class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          <button
            v-for="category in categories"
            :key="category.id"
            type="button"
            role="tab"
            :aria-selected="category.id === categoryId"
            class="min-h-12 shrink-0 rounded-button border-2 px-4 font-bold whitespace-nowrap"
            :class="
              category.id === categoryId
                ? 'border-primary bg-primary-soft text-primary-deep'
                : 'border-border-strong bg-surface text-text'
            "
            @click="categoryId = category.id"
          >
            {{ category.name }}
          </button>
        </div>

        <p v-if="menu.loading && !menu.menu" class="text-text-muted">Carregando cardápio…</p>
        <p v-else-if="products.length === 0" class="text-text-muted">
          <template v-if="search">Nenhum produto com "{{ search }}".</template>
          <template v-else>O cardápio desta unidade está vazio.</template>
        </p>
        <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <li v-for="product in products" :key="product.id">
            <button
              type="button"
              class="flex min-h-24 w-full flex-col items-start justify-between gap-1 rounded-card border-2 p-3 text-left"
              :class="
                product.soldOut
                  ? 'cursor-not-allowed border-border bg-surface-muted text-text-muted'
                  : inCart[product.id]
                    ? 'border-primary bg-surface'
                    : 'border-border-strong bg-surface hover:border-primary'
              "
              :disabled="product.soldOut || tab.status !== 'open'"
              :aria-label="`${product.name}, ${formatCents(effectivePriceCents(product, shiftPrices))}${product.soldOut ? ', esgotado' : ''}${inCart[product.id] ? `, ${inCart[product.id]} no pedido` : ''}`"
              data-testid="product-button"
              @click="choose(product)"
            >
              <span class="text-base leading-tight font-bold">{{ product.name }}</span>
              <span class="flex w-full flex-wrap items-center gap-1.5">
                <span class="font-display text-lg font-semibold tabular-nums">{{
                  formatCents(effectivePriceCents(product, shiftPrices))
                }}</span>
                <StageChip v-if="product.soldOut" status="late" label="Esgotado" />
                <StageChip
                  v-else-if="inCart[product.id]"
                  status="new"
                  :label="`${inCart[product.id]} no pedido`"
                />
              </span>
              <span
                v-if="effectivePriceCents(product, shiftPrices) !== product.priceCents"
                class="text-xs text-text-muted"
                >preço do turno</span
              >
            </button>
          </li>
        </ul>
        <p class="sr-only" aria-live="polite">{{ lastAdded }}</p>
      </template>

      <template v-if="tab && tab.status === 'open'" #footer>
        <AppButton :disabled="units === 0" data-testid="review-order" @click="reviewOpen = true">
          <template v-if="units === 0">Toque nos produtos para montar o pedido</template>
          <template v-else
            >Revisar pedido · {{ itemsLabel(units) }} · {{ formatCents(total) }}</template
          >
        </AppButton>
      </template>
    </OperationShell>

    <AppDialog v-model:open="optionsOpen" :title="optionsFor?.name ?? 'Produto'">
      <ProductOptions
        v-if="optionsFor"
        :key="optionsFor.id"
        :product="optionsFor"
        :shift-prices="shiftPrices"
        @add="addLine"
      />
    </AppDialog>

    <AppDialog v-model:open="reviewOpen" title="Revisar pedido">
      <div v-if="tab" class="flex flex-col gap-4">
        <p class="text-text-muted">Comanda {{ tabLabel(tab) }}</p>
        <ul class="flex flex-col gap-3">
          <li
            v-for="line in current.lines"
            :key="line.key"
            class="flex flex-col gap-2 rounded-card border-2 bg-surface p-3"
            :class="lineProblems(line.key).length ? 'border-error' : 'border-border'"
            data-testid="cart-line"
          >
            <div class="flex items-start gap-2">
              <div class="min-w-0 flex-1">
                <p class="text-lg font-bold">{{ line.productName }}</p>
                <p v-if="line.modifiers.length" class="text-sm text-text-muted">
                  {{ line.modifiers.map((modifier) => modifier.name).join(', ') }}
                </p>
                <p v-if="line.note" class="text-sm font-bold">Obs.: {{ line.note }}</p>
              </div>
              <span class="font-bold whitespace-nowrap tabular-nums">{{
                formatCents(lineTotalCents(line))
              }}</span>
            </div>
            <p
              v-for="problem in lineProblems(line.key)"
              :key="problem"
              class="flex items-center gap-1.5 text-sm font-bold text-error"
              data-testid="line-problem"
            >
              <AppIcon name="alert-circle" :size="16" />
              {{ problem }}
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <QuantityStepper
                :model-value="line.quantity"
                :min="0"
                :max="QUANTITY_MAX"
                :label="`Quantidade de ${line.productName}`"
                @update:model-value="cart.setQuantity(tab.id, line.key, $event)"
              />
              <button
                type="button"
                class="min-h-12 rounded-button px-3 font-bold text-primary-deep underline-offset-4 hover:underline"
                @click="startNote(line.key, line.note)"
              >
                Observação
              </button>
              <button
                type="button"
                class="ml-auto min-h-12 rounded-button px-3 font-bold text-status-late-text underline-offset-4 hover:underline"
                @click="cart.setQuantity(tab.id, line.key, 0)"
              >
                Tirar
              </button>
            </div>
            <div v-if="editingNote === line.key" class="flex flex-col gap-2">
              <label class="flex flex-col gap-1">
                <span class="font-bold">Observação de {{ line.productName }}</span>
                <textarea
                  v-model="noteDraft"
                  :maxlength="NOTE_MAX"
                  rows="2"
                  class="w-full rounded-button border-2 border-border-strong bg-surface px-4 py-2"
                />
                <span class="self-end text-sm text-text-muted tabular-nums"
                  >{{ noteDraft.length }}/{{ NOTE_MAX }}</span
                >
              </label>
              <AppButton variant="secondary" :block="false" @click="saveNote(line.key)">
                Salvar observação
              </AppButton>
            </div>
          </li>
        </ul>
        <p v-if="current.lines.length === 0" class="text-text-muted">O pedido está vazio.</p>
        <div class="flex items-baseline justify-between border-t border-border pt-3">
          <span class="font-bold">Total do pedido</span>
          <span
            class="font-display text-2xl font-extrabold tabular-nums"
            data-testid="cart-total"
            >{{ formatCents(total) }}</span
          >
        </div>
        <AppAlert v-if="sendError" tone="error">{{ sendError }}</AppAlert>
        <AppAlert v-else-if="blocking && current.lines.length > 0" tone="error">{{
          blocking
        }}</AppAlert>
        <AppButton :loading="sending" :disabled="!!blocking" data-testid="send-order" @click="send">
          <AppIcon v-if="!sending" name="send" />
          Enviar pedido
        </AppButton>
      </div>
    </AppDialog>
  </div>
</template>
