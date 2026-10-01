<script setup lang="ts">
/** Escolha da unidade em configuração; só aparece com mais de uma unidade. */
const { units, unitId, select } = usePanelUnit()
const value = computed({
  get: () => unitId.value ?? '',
  set: (id: string) => select(id),
})
</script>

<template>
  <AppSelect
    v-if="units.length > 1"
    v-model="value"
    label="Unidade"
    :options="units.map((unit) => ({ value: unit.id, label: unit.name }))"
  />
</template>
