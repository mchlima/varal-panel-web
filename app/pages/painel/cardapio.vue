<script setup lang="ts">
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { formatCents } from '~/lib/money'
import type { MenuCategory, MenuProduct } from '~/stores/menu'

/**
 * Cardápio (spec 03, seção 5 e tela "Cardápio" da seção 9): categorias em abas, produtos com
 * preço, estação e esgotado, ordenação por arrasto (com ↑/↓ como alternativa acessível) e
 * editor de produto com modificadores. Esgotado vai pela fila offline (RN-03.11).
 */
useHead({ title: 'Cardápio · Varal' })

const { $api } = useNuxtApp()
const menu = useMenuStore()
const { unitId } = usePanelUnit()
const action = useApiAction()

const selectedCategoryId = ref('')
const selectedCategory = computed<MenuCategory | null>(
  () =>
    menu.categories.find((category) => category.id === selectedCategoryId.value) ??
    menu.categories[0] ??
    null,
)

async function load() {
  if (unitId.value) await menu.load(unitId.value, { withStations: true })
}
watch(unitId, load, { immediate: true })
useRealtimeResync(load)
useRealtimeEvent('product.sold_out_changed', menu.applySoldOut)
useRealtimeEvent('menu.updated', menu.applyMenuUpdated)
useRealtimeEvent('unit.config_updated', (event) => {
  // Estações renomeadas ou desativadas mudam os nomes e as escolhas do cardápio.
  if (event.data.unitId === unitId.value) void load()
})

// Categoria: criar, editar, ordenar
const categoryDialog = ref(false)
const editingCategory = ref<MenuCategory | null>(null)
const orderDialog = ref(false)

function openCategory(category: MenuCategory | null) {
  editingCategory.value = category
  categoryDialog.value = true
}

async function categorySaved() {
  categoryDialog.value = false
  await menu.reload()
}

async function reorderCategories(ids: string[]) {
  const id = unitId.value
  if (!id) return
  await action.run(() =>
    $api.PUT('/api/v1/units/{id}/categories/order', {
      params: { path: { id } },
      body: { categoryIds: ids },
    }),
  )
  await menu.reload()
}

async function reorderProducts(ids: string[]) {
  const category = selectedCategory.value
  if (!category) return
  await action.run(() =>
    $api.PUT('/api/v1/categories/{id}/products/order', {
      params: { path: { id: category.id } },
      body: { productIds: ids },
    }),
  )
  await menu.reload()
}

// Produto
const productDialog = ref(false)
const productId = ref<string | null>(null)
const productTitle = computed(() =>
  productId.value ? (menu.findProduct(productId.value)?.name ?? 'Produto') : 'Novo produto',
)

function openProduct(product: MenuProduct | null) {
  productId.value = product?.id ?? null
  productDialog.value = true
}

function stationLabel(product: MenuProduct): string {
  const name = menu.stationName(product.prepStationId)
  return product.stationId ? name : `${name} (da categoria)`
}
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl">Cardápio</h1>
      <p class="text-text-muted">
        Preços e modificadores podem mudar a qualquer hora e valem para os próximos pedidos.
      </p>
    </div>
    <UnitPicker />

    <AppAlert v-if="menu.loadError" tone="error">{{ menu.loadError }}</AppAlert>
    <p v-else-if="menu.loading && !menu.menu" class="text-text-muted">Carregando cardápio…</p>

    <template v-else-if="menu.menu">
      <ErrorAlert :error="action.error.value" @reload="load" />

      <section aria-labelledby="categories-title" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <h2 id="categories-title" class="flex-1 text-xl">Categorias</h2>
          <AppButton
            v-if="menu.categories.length > 1"
            variant="ghost"
            :block="false"
            class="px-2"
            @click="orderDialog = true"
          >
            <AppIcon name="grip" />
            Ordenar
          </AppButton>
          <AppButton variant="secondary" :block="false" @click="openCategory(null)">
            <AppIcon name="plus" />
            Nova categoria
          </AppButton>
        </div>

        <AppAlert v-if="menu.categories.length === 0">
          O cardápio está vazio. Comece criando uma categoria (ex.: Espetos, Bebidas).
        </AppAlert>

        <TabsRoot
          v-else
          :model-value="selectedCategory?.id"
          @update:model-value="selectedCategoryId = String($event)"
        >
          <TabsList
            aria-label="Categorias"
            class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0"
          >
            <TabsTrigger
              v-for="category in menu.categories"
              :key="category.id"
              :value="category.id"
              class="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-button border-2 px-4 font-bold data-[state=active]:border-primary data-[state=active]:bg-primary-soft data-[state=active]:text-primary-deep data-[state=inactive]:border-border-strong data-[state=inactive]:bg-surface"
            >
              {{ category.name }}
              <AppIcon v-if="!category.active" name="power" :size="14" label="Desativada" />
            </TabsTrigger>
          </TabsList>
        </TabsRoot>
      </section>

      <section
        v-if="selectedCategory"
        :aria-label="`Produtos de ${selectedCategory.name}`"
        class="flex flex-col gap-3"
      >
        <div
          class="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface p-3"
        >
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="font-display text-lg font-semibold">{{ selectedCategory.name }}</span>
            <span class="text-sm text-text-muted">
              Preparo padrão: {{ menu.stationName(selectedCategory.defaultStationId) }}
            </span>
          </div>
          <StatusChip v-if="!selectedCategory.active" tone="inactive" label="Desativada" />
          <AppButton
            variant="ghost"
            :block="false"
            class="px-2"
            @click="openCategory(selectedCategory)"
          >
            <AppIcon name="edit" />
            Editar categoria
          </AppButton>
        </div>

        <p v-if="selectedCategory.products.length === 0" class="text-text-muted">
          Nenhum produto nesta categoria ainda.
        </p>
        <SortableList
          v-else
          :items="selectedCategory.products"
          :item-label="(product) => product.name"
          noun="produto"
          :disabled="action.busy.value"
          @reorder="reorderProducts"
        >
          <template #default="{ item: product }">
            <div class="flex flex-wrap items-center gap-2 pr-1" data-testid="product-row">
              <button
                type="button"
                class="flex min-h-12 min-w-0 flex-1 basis-full flex-col items-start text-left sm:basis-auto"
                @click="openProduct(product)"
              >
                <span class="font-bold" :class="product.active ? '' : 'text-text-muted'">
                  {{ product.name }}
                </span>
                <span class="text-sm text-text-muted">
                  <strong class="text-text">{{ formatCents(product.priceCents) }}</strong>
                  · {{ stationLabel(product) }}
                  <template v-if="product.modifierGroups.length">
                    · {{ product.modifierGroups.length }}
                    {{ product.modifierGroups.length === 1 ? 'grupo' : 'grupos' }} de modificadores
                  </template>
                </span>
                <StatusChip v-if="!product.active" tone="inactive" label="Inativo" class="mt-1" />
              </button>
              <SoldOutToggle :product="product" />
            </div>
          </template>
        </SortableList>
        <AppButton @click="openProduct(null)">
          <AppIcon name="plus" />
          Novo produto em {{ selectedCategory.name }}
        </AppButton>
      </section>
    </template>

    <AppDialog
      v-model:open="categoryDialog"
      :title="editingCategory ? `Editar ${editingCategory.name}` : 'Nova categoria'"
    >
      <CategoryForm
        v-if="categoryDialog && unitId"
        :unit-id="unitId"
        :category="editingCategory"
        @saved="categorySaved"
        @cancel="categoryDialog = false"
      />
    </AppDialog>

    <AppDialog v-model:open="orderDialog" title="Ordenar categorias">
      <p class="mb-3 text-text-muted">
        Arraste pela alça ou use as setas. A ordem vale para o balcão.
      </p>
      <SortableList
        :items="menu.categories"
        :item-label="(category) => category.name"
        noun="categoria"
        :disabled="action.busy.value"
        @reorder="reorderCategories"
      >
        <template #default="{ item: category }">
          <span class="flex min-h-12 items-center font-bold">{{ category.name }}</span>
        </template>
      </SortableList>
    </AppDialog>

    <AppDialog v-model:open="productDialog" :title="productTitle">
      <ProductEditor
        v-if="productDialog && unitId && selectedCategory"
        :key="productId ?? 'new'"
        :unit-id="unitId"
        :product-id="productId"
        :category-id="selectedCategory.id"
        @created="productId = $event"
        @close="productDialog = false"
      />
    </AppDialog>
  </PanelShell>
</template>
