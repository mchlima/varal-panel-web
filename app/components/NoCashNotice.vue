<script setup lang="ts">
import { canOperateCashIn } from '~/lib/routes'

/**
 * Sem caixa aberto na unidade (spec 04, seção 8.1; RN-04.02; CA-05.08): "Abra um caixa para
 * vender". Quem opera caixa (e o dono) vê o botão principal "Abrir caixa"; os outros, o pedido
 * para quem cuida do caixa. As comandas que já existem continuam podendo ser atendidas.
 */
const props = withDefaults(defineProps<{ unitId: string; primary?: boolean }>(), {
  primary: true,
})
const session = useSessionStore()
const operations = useOperationStore()
const canOpen = computed(() => canOperateCashIn(session.me, props.unitId))

/** Com um único caixa cadastrado, vai direto à abertura dele; com mais, à lista (spec 05). */
const openPath = computed(() => {
  const registers = (operations.get(props.unitId)?.cashRegisters ?? []).filter((r) => r.active)
  return registers.length === 1
    ? `/caixas/${registers[0]!.id}/abrir?volta=balcao`
    : '/caixas?volta=balcao'
})
</script>

<template>
  <div
    class="flex flex-col gap-3 rounded-card border-2 border-border-strong bg-surface p-4"
    data-testid="no-cash"
  >
    <p class="flex items-center gap-2 text-lg font-bold">
      <AppIcon name="wallet" />
      Abra um caixa para vender
    </p>
    <p v-if="canOpen" class="text-text-muted">
      Sem caixa aberto não dá para abrir comanda nem lançar pedido. As comandas que já estão no
      varal continuam podendo ser atendidas.
    </p>
    <p v-else class="text-text-muted">
      Peça para quem cuida do caixa abri-lo. A tela atualiza sozinha quando o caixa abrir.
    </p>
    <AppButton v-if="canOpen" :variant="primary ? 'primary' : 'secondary'" :to="openPath">
      <AppIcon name="wallet" />
      Abrir caixa
    </AppButton>
  </div>
</template>
