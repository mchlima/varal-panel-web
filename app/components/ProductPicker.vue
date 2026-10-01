<script setup lang="ts">
import { formatCents } from '~/lib/money'
import {
  buildLine,
  effectivePriceCents,
  needsOptions,
  type CartLine,
  type MenuProduct,
  type ShiftPrice,
} from '~/lib/order-builder'

/**
 * Produtos para montar pedido (spec 04, seção 8.1): categorias em abas, busca, produtos em
 * botões grandes com o preço do turno quando houver (RN-04.06), esgotados visíveis e bloqueados
 * (RN-03.10, CA-03.05) e a folha de opções (RN-03.13). O que é escolhido entra no carrinho
 * `cartKey` deste aparelho (comanda aberta ou rascunho do paga antes).
 */
const props = withDefaults(
  defineProps<{
    categories: { id: string; name: string; products: MenuProduct[] }[]
    cartKey: string
    shiftPrices: readonly ShiftPrice[]
    loading?: boolean
    disabled?: boolean
  }>(),
  { loading: false, disabled: false },
)

const cart = useCartStore()
const categoryId = ref<string | null>(null)
const search = ref('')
watchEffect(() => {
  if (!props.categories.some((category) => category.id === categoryId.value)) {
    categoryId.value = props.categories[0]?.id ?? null
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
    return props.categories
      .flatMap((category) => category.products)
      .filter((product) => normalize(product.name).includes(query))
  }
  return props.categories.find((category) => category.id === categoryId.value)?.products ?? []
})

const inCart = computed(() => {
  const result: Record<string, number> = {}
  for (const line of cart.cartOf(props.cartKey).lines) {
    result[line.productId] = (result[line.productId] ?? 0) + line.quantity
  }
  return result
})

const optionsFor = ref<MenuProduct | null>(null)
const optionsOpen = computed({
  get: () => optionsFor.value !== null,
  set: (open: boolean) => {
    if (!open) optionsFor.value = null
  },
})
const lastAdded = ref('')

function choose(product: MenuProduct) {
  if (props.disabled || product.soldOut) return
  if (needsOptions(product)) {
    optionsFor.value = product
    return
  }
  cart.add(
    props.cartKey,
    buildLine({
      product,
      shiftPrices: [...props.shiftPrices],
      modifiers: [],
      quantity: 1,
      note: '',
    }),
  )
  lastAdded.value = `${product.name} adicionado.`
}

function addLine(line: CartLine) {
  cart.add(props.cartKey, line)
  lastAdded.value = `${line.quantity} ${line.productName} adicionado.`
  optionsFor.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4">
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

    <p v-if="loading && categories.length === 0" class="text-text-muted">Carregando cardápio…</p>
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
          :disabled="product.soldOut || disabled"
          :aria-label="`${product.name}, ${formatCents(effectivePriceCents(product, [...shiftPrices]))}${product.soldOut ? ', esgotado' : ''}${inCart[product.id] ? `, ${inCart[product.id]} no pedido` : ''}`"
          data-testid="product-button"
          @click="choose(product)"
        >
          <span class="text-base leading-tight font-bold">{{ product.name }}</span>
          <span class="flex w-full flex-wrap items-center gap-1.5">
            <span class="font-display text-lg font-semibold tabular-nums">{{
              formatCents(effectivePriceCents(product, [...shiftPrices]))
            }}</span>
            <StageChip v-if="product.soldOut" status="late" label="Esgotado" />
            <StageChip
              v-else-if="inCart[product.id]"
              status="new"
              :label="`${inCart[product.id]} no pedido`"
            />
          </span>
          <span
            v-if="effectivePriceCents(product, [...shiftPrices]) !== product.priceCents"
            class="text-xs text-text-muted"
            >preço do turno</span
          >
        </button>
      </li>
    </ul>
    <p class="sr-only" aria-live="polite">{{ lastAdded }}</p>

    <AppDialog v-model:open="optionsOpen" :title="optionsFor?.name ?? 'Produto'">
      <ProductOptions
        v-if="optionsFor"
        :key="optionsFor.id"
        :product="optionsFor"
        :shift-prices="[...shiftPrices]"
        @add="addLine"
      />
    </AppDialog>
  </div>
</template>
