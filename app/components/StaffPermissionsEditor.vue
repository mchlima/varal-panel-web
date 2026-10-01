<script setup lang="ts">
import type { StaffPermissionInput } from '~/lib/staff'

/**
 * Permissões por unidade (RN-03.16): quais estações o colaborador abre e se opera o caixa.
 * As unidades e estações vêm do `/auth/me` do dono (ativas, em ordem). Permissões de
 * unidades que não aparecem aqui (desativadas) são mantidas como estão.
 */
const model = defineModel<StaffPermissionInput[]>({ required: true })
const session = useSessionStore()
const units = computed(() => session.me?.units ?? [])

function permissionOf(unitId: string): StaffPermissionInput | undefined {
  return model.value.find((permission) => permission.unitId === unitId)
}

function setUnit(unitId: string, enabled: boolean) {
  if (enabled && !permissionOf(unitId)) {
    model.value = [...model.value, { unitId, stationIds: [], canOperateCash: false }]
  } else if (!enabled) {
    model.value = model.value.filter((permission) => permission.unitId !== unitId)
  }
}

function update(unitId: string, change: Partial<StaffPermissionInput>) {
  model.value = model.value.map((permission) =>
    permission.unitId === unitId ? { ...permission, ...change } : permission,
  )
}

function setStation(unitId: string, stationId: string, enabled: boolean) {
  const current = permissionOf(unitId)
  if (!current) return
  const ids = new Set(current.stationIds)
  if (enabled) ids.add(stationId)
  else ids.delete(stationId)
  // Mantém a ordem de exibição das estações.
  const order = units.value.find((unit) => unit.id === unitId)?.stations.map((s) => s.id) ?? []
  update(unitId, { stationIds: order.filter((id) => ids.has(id)) })
}

const visibleUnitIds = computed(() => new Set(units.value.map((unit) => unit.id)))
const hasAnyUnit = computed(() => model.value.some((p) => visibleUnitIds.value.has(p.unitId)))
</script>

<template>
  <fieldset class="flex flex-col gap-3">
    <legend class="mb-1 font-bold">Unidades e estações liberadas</legend>
    <div
      v-for="unit in units"
      :key="unit.id"
      class="flex flex-col gap-1 rounded-card border border-border bg-surface-muted p-3"
    >
      <AppCheckbox
        :model-value="!!permissionOf(unit.id)"
        :label="unit.name"
        description="Libera esta unidade para o colaborador."
        @update:model-value="setUnit(unit.id, $event)"
      />
      <div v-if="permissionOf(unit.id)" class="flex flex-col gap-0 border-l-2 border-border pl-4">
        <AppCheckbox
          v-for="station in unit.stations"
          :key="station.id"
          :model-value="permissionOf(unit.id)!.stationIds.includes(station.id)"
          :label="station.name"
          :description="station.kind === 'counter' ? 'Balcão de pedidos' : 'Fila'"
          @update:model-value="setStation(unit.id, station.id, $event)"
        />
        <AppCheckbox
          :model-value="permissionOf(unit.id)!.canOperateCash"
          label="Pode operar o caixa"
          @update:model-value="update(unit.id, { canOperateCash: $event })"
        />
      </div>
    </div>
    <AppAlert v-if="!hasAnyUnit">
      Sem nenhuma unidade liberada, o colaborador não consegue entrar.
    </AppAlert>
  </fieldset>
</template>
