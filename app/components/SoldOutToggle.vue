<script setup lang="ts">
/**
 * Atalho de esgotado (spec 03, seção 9; RN-03.11): o dono no cardápio e o colaborador no
 * balcão ou na estação marcam e desmarcam a qualquer momento, inclusive com caixa aberto.
 * A mudança vai pela fila offline e chega aos balcões por `product.sold_out_changed`.
 */
const props = defineProps<{ product: { id: string; name: string; soldOut: boolean } }>()

const menu = useMenuStore()
const { setSoldOut, error } = useSoldOut()
const pending = computed(() => props.product.id in menu.pendingSoldOut)

function toggle() {
  void setSoldOut(props.product, !props.product.soldOut)
}
</script>

<template>
  <div class="flex flex-col items-end gap-1">
    <button
      type="button"
      :aria-pressed="product.soldOut"
      :aria-label="`Esgotado: ${product.name}`"
      class="inline-flex min-h-12 items-center gap-2 rounded-button border-2 px-3 font-bold"
      :class="
        product.soldOut
          ? 'border-status-late-text bg-status-late-bg text-status-late-text'
          : 'border-border-strong bg-surface text-text'
      "
      data-testid="sold-out-toggle"
      @click="toggle"
    >
      <AppIcon :name="product.soldOut ? 'ban' : 'check-circle'" />
      <span>{{ product.soldOut ? 'Esgotado' : 'Disponível' }}</span>
    </button>
    <span v-if="pending" class="inline-flex items-center gap-1 text-xs text-text-muted">
      <AppIcon name="refresh" :size="14" />
      Enviando…
    </span>
    <span v-if="error" role="alert" class="text-sm text-error">{{ error }}</span>
  </div>
</template>
