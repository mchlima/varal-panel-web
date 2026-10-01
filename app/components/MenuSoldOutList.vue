<script setup lang="ts">
/**
 * Cardápio da unidade com o atalho de esgotado (spec 03, seção 9), para o balcão e as
 * estações. Recarrega por REST a cada reconexão (RN-01.05) e aplica `product.sold_out_changed`
 * e `menu.updated` em tempo real (CA-03.05).
 */
const props = defineProps<{ unitId: string }>()
const menu = useMenuStore()

async function load() {
  await menu.load(props.unitId)
}
watch(() => props.unitId, load, { immediate: true })
useRealtimeResync(load)
useRealtimeEvent('product.sold_out_changed', menu.applySoldOut)
useRealtimeEvent('menu.updated', menu.applyMenuUpdated)
</script>

<template>
  <section aria-labelledby="sold-out-title" class="flex flex-col gap-3">
    <div class="flex flex-col gap-1">
      <h2 id="sold-out-title" class="text-xl">Esgotados</h2>
      <p class="text-text-muted">
        Toque no produto que acabou: ele fica bloqueado no balcão na hora. Toque de novo quando
        voltar.
      </p>
    </div>
    <AppAlert v-if="menu.loadError" tone="error">{{ menu.loadError }}</AppAlert>
    <p v-else-if="menu.loading && !menu.menu" class="text-text-muted">Carregando cardápio…</p>
    <p v-else-if="menu.categories.length === 0" class="text-text-muted">
      O cardápio desta unidade ainda está vazio.
    </p>
    <div v-for="category in menu.categories" :key="category.id" class="flex flex-col gap-2">
      <h3 class="font-display text-lg font-semibold">{{ category.name }}</h3>
      <ul class="flex flex-col gap-2">
        <li
          v-for="product in category.products"
          :key="product.id"
          class="flex items-center gap-3 rounded-card border border-border bg-surface px-3 py-2"
        >
          <span class="min-w-0 flex-1 font-bold" :class="product.soldOut ? 'text-text-muted' : ''">
            {{ product.name }}
          </span>
          <SoldOutToggle :product="product" />
        </li>
      </ul>
    </div>
  </section>
</template>
