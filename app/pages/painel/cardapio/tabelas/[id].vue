<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
import { centsToInput, formatCents } from '~/lib/money'
import type { PriceList } from '~/lib/operation'
import { priceChanges, pricesToInput } from '~/lib/price-lists'

/**
 * Preços de uma tabela (`/painel/cardapio/tabelas/{id}`, spec 03, RN-03.22): todos os produtos
 * ativos da unidade, por categoria, com o preço normal ao lado do campo da tabela. Campo vazio =
 * preço normal (RN-03.21). Salva tudo de uma vez (`PUT /price-lists/{id}/prices`), só o que mudou;
 * vale para itens novos, inclusive na tabela vigente (RN-03.24).
 */
const route = useRoute()
const { $api } = useNuxtApp()
const menu = useMenuStore()
const action = useApiAction()
const id = computed(() => String(route.params.id))

const priceList = ref<PriceList | null>(null)
const saved = ref<Record<string, number>>({})
const input = ref<Record<string, string>>({})
const fieldErrors = ref<Record<string, string>>({})
const loadError = ref('')
const done = ref('')

useHead({ title: () => `${priceList.value?.name ?? 'Tabela'} · Tabelas de preço · Varal` })

async function load() {
  try {
    const { data, error } = await $api.GET('/api/v1/price-lists/{id}', {
      params: { path: { id: id.value } },
    })
    if (!data) {
      loadError.value = apiErrorMessage(error)
      return
    }
    loadError.value = ''
    priceList.value = data.priceList
    saved.value = Object.fromEntries(data.prices.map((p) => [p.productId, p.priceCents]))
    input.value = pricesToInput(saved.value)
    if (menu.unitId !== data.priceList.unitId || !menu.menu) await menu.load(data.priceList.unitId)
  } catch (error) {
    loadError.value = apiErrorMessage(error)
  }
}
watch(id, load, { immediate: true })
useRealtimeResync(load)

/** Só produtos ativos de categorias ativas: os que o balcão vende (RN-03.10). */
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

const pending = computed(() => priceChanges(saved.value, input.value))
const changedCount = computed(() => pending.value.changes.length)

function setPrice(productId: string, value: string) {
  input.value = { ...input.value, [productId]: value }
  done.value = ''
}

async function save() {
  const list = priceList.value
  if (!list) return
  done.value = ''
  const { changes, errors } = pending.value
  fieldErrors.value = errors
  if (Object.keys(errors).length) return
  if (changes.length === 0) {
    done.value = 'Nada mudou desde o último salvamento.'
    return
  }
  const result = await action.run(() =>
    $api.PUT('/api/v1/price-lists/{id}/prices', {
      params: { path: { id: list.id } },
      body: {
        prices: changes.map((change) => ({
          productId: change.key,
          priceCents: change.priceCents,
        })),
      },
    }),
  )
  if (result.ok && result.data) {
    priceList.value = result.data.priceList
    saved.value = Object.fromEntries(result.data.prices.map((p) => [p.productId, p.priceCents]))
    input.value = pricesToInput(saved.value)
    done.value = `Preços salvos. Valem para os próximos pedidos com a tabela ${result.data.priceList.name}.`
  }
}
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <NuxtLink
        to="/painel/cardapio/tabelas"
        class="inline-flex min-h-12 items-center gap-1 self-start font-bold text-primary-deep"
      >
        <AppIcon name="arrow-left" />
        Tabelas de preço
      </NuxtLink>
      <h1 class="text-2xl">Preços: {{ priceList?.name ?? '…' }}</h1>
      <p class="text-text-muted">
        Digite o preço de cada produto nesta tabela. Deixe vazio para cobrar o preço normal.
      </p>
    </div>

    <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
    <p v-else-if="!priceList || (menu.loading && !menu.menu)" class="text-text-muted">
      Carregando…
    </p>
    <template v-else>
      <AppAlert v-if="!priceList.active">
        Esta tabela está desativada e não aparece para escolha. Reative em Tabelas de preço.
      </AppAlert>
      <AppAlert v-if="categories.length === 0">
        <p class="font-bold">Nenhum produto ativo no cardápio.</p>
        <p>
          Cadastre os produtos no
          <NuxtLink to="/painel/cardapio" class="font-bold underline">Cardápio</NuxtLink> e volte
          aqui para dar o preço desta tabela.
        </p>
      </AppAlert>

      <form
        v-else
        class="flex flex-col gap-6"
        novalidate
        :aria-label="`Preços da tabela ${priceList.name}`"
        @submit.prevent="save"
      >
        <section
          v-for="category in categories"
          :key="category.id"
          class="flex flex-col gap-2"
          :aria-label="category.name"
        >
          <h2 class="text-xl">{{ category.name }}</h2>
          <ul
            class="flex flex-col divide-y divide-border rounded-card border border-border bg-surface"
          >
            <li
              v-for="product in category.products"
              :key="product.id"
              class="flex flex-wrap items-center gap-3 px-4 py-3"
              data-testid="price-row"
            >
              <span class="flex min-w-0 flex-1 basis-40 flex-col">
                <span class="font-bold">{{ product.name }}</span>
                <span class="text-sm text-text-muted"
                  >Normal: {{ formatCents(product.priceCents) }}</span
                >
              </span>
              <div class="w-40">
                <AppTextField
                  :model-value="input[product.id] ?? ''"
                  :label="`${priceList.name}: ${product.name}`"
                  prefix="R$"
                  inputmode="decimal"
                  :placeholder="centsToInput(product.priceCents)"
                  :error="fieldErrors[product.id] ?? ''"
                  class="[&>label]:sr-only"
                  @update:model-value="setPrice(product.id, $event)"
                />
              </div>
            </li>
          </ul>
        </section>

        <ErrorAlert :error="action.error.value" @reload="load" />
        <AppAlert v-if="done" tone="success">{{ done }}</AppAlert>
        <div class="sticky bottom-20 lg:bottom-4">
          <AppButton type="submit" :loading="action.busy.value" data-testid="save-prices">
            {{
              changedCount === 0
                ? 'Salvar preços'
                : changedCount === 1
                  ? 'Salvar 1 alteração'
                  : `Salvar ${changedCount} alterações`
            }}
          </AppButton>
        </div>
      </form>
    </template>
  </PanelShell>
</template>
