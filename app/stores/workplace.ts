import { defineStore } from 'pinia'
import { readLocal, writeLocal } from '~/lib/browser'

const UNIT_KEY = 'varal.unitId'
const STATION_KEY = 'varal.stationId'

/** Unidade e estação escolhidas neste aparelho (spec 01, seção 14: "Escolher estação"). */
export const useWorkplaceStore = defineStore('workplace', () => {
  const unitId = ref<string | null>(readLocal(UNIT_KEY))
  const stationId = ref<string | null>(readLocal(STATION_KEY))

  function selectUnit(id: string | null) {
    if (unitId.value !== id) selectStation(null)
    unitId.value = id
    writeLocal(UNIT_KEY, id)
  }

  function selectStation(id: string | null) {
    stationId.value = id
    writeLocal(STATION_KEY, id)
  }

  function clear() {
    selectUnit(null)
  }

  return { unitId, stationId, selectUnit, selectStation, clear }
})
