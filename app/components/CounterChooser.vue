<script setup lang="ts">
/** Escolha do balcão quando a unidade tem mais de um (spec 01, RN-01.24: "pergunta qual"). */
const props = defineProps<{
  choices: { unitId: string; stations: { id: string; name: string }[] } | null
}>()
const emit = defineEmits<{ choose: [unitId: string, stationId: string]; close: [] }>()
const open = computed({
  get: () => props.choices !== null,
  set: (value: boolean) => {
    if (!value) emit('close')
  },
})
</script>

<template>
  <AppDialog v-model:open="open" title="Qual balcão?">
    <ul v-if="choices" class="flex flex-col gap-2">
      <li v-for="station in choices.stations" :key="station.id">
        <button
          type="button"
          class="flex min-h-16 w-full items-center gap-3 rounded-card border-2 border-border-strong bg-surface px-4 text-left text-lg font-bold hover:border-primary"
          @click="emit('choose', choices.unitId, station.id)"
        >
          <AppIcon name="receipt" />
          <span class="flex-1">{{ station.name }}</span>
          <AppIcon name="chevron-right" />
        </button>
      </li>
    </ul>
  </AppDialog>
</template>
