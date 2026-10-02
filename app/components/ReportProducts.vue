<script setup lang="ts">
import { formatCents } from '~/lib/money'
import type { ReportProductLine } from '~/lib/report'

/**
 * "Por produto" (spec 07, seção 4): quantidade e valor de cada produto, maior valor primeiro,
 * com os modificadores com acréscimo e, quando houve venda com tabela de preço, a quebra por
 * tabela (RN-07.04, RN-07.05: valores do preço gravado no item).
 */
const props = defineProps<{ products: readonly ReportProductLine[] }>()
const total = computed(() => props.products.reduce((sum, line) => sum + line.valueCents, 0))
</script>

<template>
  <ReportSection title="Por produto" :aside="formatCents(total)" data-testid="report-products">
    <p v-if="products.length === 0" class="text-text-muted">Nenhum item vendido.</p>
    <p v-else class="text-sm text-text-muted">
      Valores antes do desconto da comanda (o desconto está no resumo).
    </p>
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="line in products"
        :key="`${line.productId}-${line.productName}`"
        class="flex flex-col gap-1 py-2"
      >
        <div class="flex items-baseline gap-3">
          <span class="min-w-0 flex-1 font-bold">{{ line.productName }}</span>
          <span class="text-sm whitespace-nowrap text-text-muted tabular-nums"
            >{{ line.quantity }} un.</span
          >
          <span class="font-bold whitespace-nowrap tabular-nums">{{
            formatCents(line.valueCents)
          }}</span>
        </div>
        <ul v-if="line.priceLists.length" class="flex flex-col gap-0.5 pl-3 text-sm">
          <li
            v-for="list in line.priceLists"
            :key="list.priceListId ?? 'normal'"
            class="flex items-baseline gap-3"
          >
            <span class="flex min-w-0 flex-1 items-center gap-1">
              <AppIcon name="tag" :size="14" />
              Preços: {{ list.priceListName }}
            </span>
            <span class="whitespace-nowrap tabular-nums">{{ list.quantity }} un.</span>
            <span class="whitespace-nowrap tabular-nums">{{ formatCents(list.valueCents) }}</span>
          </li>
        </ul>
        <ul v-if="line.modifiers.length" class="flex flex-col gap-0.5 pl-3 text-sm">
          <li
            v-for="modifier in line.modifiers"
            :key="`${modifier.groupName}-${modifier.modifierName}`"
            class="flex items-baseline gap-3 text-text-muted"
          >
            <span class="min-w-0 flex-1"
              >+ {{ modifier.modifierName }} ({{ modifier.groupName }})</span
            >
            <span class="whitespace-nowrap tabular-nums">{{ modifier.quantity }} un.</span>
            <span class="whitespace-nowrap tabular-nums">{{
              formatCents(modifier.valueCents)
            }}</span>
          </li>
        </ul>
      </li>
    </ul>
  </ReportSection>
</template>
