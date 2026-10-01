import type { VaralDatabase } from './db'
import { isUuid, uuidv7 } from './uuid'

export const DEVICE_ID_KEY = 'varal.deviceId'

export interface DeviceIdStores {
  /** `localStorage`, se o navegador deixar usar. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  /** Banco local (IndexedDB), cópia que sobrevive a uma limpeza só do `localStorage`. */
  db?: VaralDatabase | null
}

function readStorage(storage: DeviceIdStores['storage']): string | null {
  try {
    return storage?.getItem(DEVICE_ID_KEY) ?? null
  } catch {
    return null
  }
}

function writeStorage(storage: DeviceIdStores['storage'], value: string): void {
  try {
    storage?.setItem(DEVICE_ID_KEY, value)
  } catch {
    // Modo privado ou armazenamento bloqueado: segue só com a cópia do IndexedDB.
  }
}

async function readDb(db: DeviceIdStores['db']): Promise<string | null> {
  try {
    return (await db?.meta.get(DEVICE_ID_KEY))?.value ?? null
  } catch {
    return null
  }
}

async function writeDb(db: DeviceIdStores['db'], value: string): Promise<void> {
  try {
    await db?.meta.put({ key: DEVICE_ID_KEY, value })
  } catch {
    // IndexedDB indisponível: segue com o localStorage.
  }
}

/**
 * Identificador do aparelho (spec 01, seção 7.2): um UUID gerado uma única vez e
 * guardado no `localStorage` e no IndexedDB. Vai em toda requisição (`X-Device-Id`)
 * e no `auth` do socket. Se nenhum dos dois puder ser gravado, vale só nesta aba.
 */
export async function loadDeviceId(stores: DeviceIdStores): Promise<string> {
  const fromStorage = readStorage(stores.storage)
  const fromDb = await readDb(stores.db)
  const existing = [fromStorage, fromDb].find(isUuid)
  const deviceId = existing ?? uuidv7()

  if (fromStorage !== deviceId) writeStorage(stores.storage, deviceId)
  if (fromDb !== deviceId) await writeDb(stores.db, deviceId)
  return deviceId
}
