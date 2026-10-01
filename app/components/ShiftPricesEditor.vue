<script setup lang="ts">
import { formatCents } from '~/lib/money'
import type { MenuCategory } from '~/stores/menu'

/**
 * Tabela de preços do turno (RN-04.06): para cada produto, um preço opcional; vazio = preço do
 * cardápio. Acréscimos de modificadores não mudam. Valores digitados em reais e enviados em
 * centavos (`parseReais`).
 */
defineProps<{ categories: readonly MenuCategory[]; errors?: Record<string, string> }>()
const model = defineModel<Record<string, string>>({ required: true })

function set(productId: string, value: string) {
  model.value = { ...model.value, [productId]: value }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-text-muted">
      Deixe em branco para usar o preço do cardápio. Acréscimos dos modificadores não mudam.
    </p>
    <section v-for="category in categories" :key="category.id" class="flex flex-col gap-2">
      <h3 class="font-display text-lg font-semibold">{{ category.name }}</h3>
      <ul class="flex flex-col gap-2">
        <li
          v-for="product in category.products"
          :key="product.id"
          class="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3 rounded-card border border-border bg-surface px-3 py-2"
        >
          <span class="flex min-w-0 flex-col">
            <span class="truncate font-bold">{{ product.name }}</span>
            <span class="text-sm text-text-muted"
              >Cardápio: {{ formatCents(product.priceCents) }}</span
            >
          </span>
          <label class="flex flex-col gap-1">
            <span class="sr-only">Preço no turno de {{ product.name }}</span>
            <span class="relative">
              <span
                aria-hidden="true"
                class="pointer-events-none absolute top-0 left-0 flex h-12 items-center pl-3 font-bold text-text-muted"
                >R$</span
              >
              <input
                :value="model[product.id] ?? ''"
                inputmode="decimal"
                placeholder="—"
                class="min-h-12 w-full rounded-button border-2 bg-surface pr-3 pl-10 text-right text-base tabular-nums"
                :class="errors?.[product.id] ? 'border-error' : 'border-border-strong'"
                :aria-invalid="errors?.[product.id] ? 'true' : undefined"
                :data-testid="`shift-price-${product.name}`"
                @input="set(product.id, ($event.target as HTMLInputElement).value)"
              />
            </span>
            <span v-if="errors?.[product.id]" class="text-sm text-error">{{
              errors[product.id]
            }}</span>
          </label>
        </li>
      </ul>
    </section>
  </div>
</template>
