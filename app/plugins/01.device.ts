import { createDatabase, type VaralDatabase } from '~/lib/db'
import { loadDeviceId } from '~/lib/device-id'

function openDatabase(): VaralDatabase | null {
  if (typeof indexedDB === 'undefined') return null
  try {
    return createDatabase(undefined, { indexedDB, IDBKeyRange })
  } catch {
    return null
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Banco local (IndexedDB) e identificador do aparelho (spec 01, seção 7.2). Roda antes
 * dos demais plugins: o `X-Device-Id` vai já na primeira requisição.
 */
export default defineNuxtPlugin({
  name: 'varal:device',
  async setup(): Promise<{ provide: { db: VaralDatabase | null; deviceId: string } }> {
    const db = openDatabase()
    const deviceId = await loadDeviceId({ storage: safeLocalStorage(), db })
    return { provide: { db, deviceId } }
  },
})
