<script setup lang="ts">
/**
 * Sem turno aberto (RN-04.09: toda comanda pertence a um turno aberto): orienta quem pode abrir
 * (dono e quem opera caixa, RN-04.02) e quem precisa pedir.
 */
const props = defineProps<{ unitId: string }>()
const session = useSessionStore()
const canOpen = computed(
  () =>
    session.isOwner ||
    session.me?.units.some((unit) => unit.id === props.unitId && unit.canOperateCash) === true,
)
</script>

<template>
  <AppAlert>
    <p class="font-bold">Nenhum turno aberto nesta unidade.</p>
    <p v-if="canOpen">Abra o turno para começar a registrar comandas e pedidos.</p>
    <p v-else>
      Peça para o dono ou para quem opera o caixa abrir o turno. A tela atualiza sozinha.
    </p>
  </AppAlert>
  <AppButton v-if="canOpen" :to="`/painel/turnos?unidade=${unitId}`">Abrir turno</AppButton>
</template>
