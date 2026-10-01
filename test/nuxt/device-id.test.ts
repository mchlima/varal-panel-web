import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '~/lib/db'
import { DEVICE_ID_KEY, loadDeviceId } from '~/lib/device-id'
import { isUuid } from '~/lib/uuid'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  }
}

function freshDb() {
  return createDatabase('varal-test', { indexedDB: new IDBFactory(), IDBKeyRange })
}

describe('deviceId (spec 01, seção 7.2)', () => {
  it('gera um UUID v7 uma única vez e guarda no localStorage e no IndexedDB', async () => {
    const storage = memoryStorage()
    const db = freshDb()
    const first = await loadDeviceId({ storage, db })
    expect(isUuid(first)).toBe(true)
    expect(first[14]).toBe('7')
    expect(storage.map.get(DEVICE_ID_KEY)).toBe(first)
    expect((await db.meta.get(DEVICE_ID_KEY))?.value).toBe(first)

    await expect(loadDeviceId({ storage, db })).resolves.toBe(first)
  })

  it('recupera do IndexedDB se o localStorage foi limpo', async () => {
    const db = freshDb()
    const first = await loadDeviceId({ storage: memoryStorage(), db })
    const cleared = memoryStorage()
    await expect(loadDeviceId({ storage: cleared, db })).resolves.toBe(first)
    expect(cleared.map.get(DEVICE_ID_KEY)).toBe(first)
  })

  it('funciona com armazenamento bloqueado (só nesta aba)', async () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    }
    const id = await loadDeviceId({ storage: blocked, db: null })
    expect(isUuid(id)).toBe(true)
  })

  it('ignora valor inválido guardado', async () => {
    const storage = memoryStorage()
    storage.setItem(DEVICE_ID_KEY, 'lixo')
    const id = await loadDeviceId({ storage, db: null })
    expect(isUuid(id)).toBe(true)
    expect(storage.map.get(DEVICE_ID_KEY)).toBe(id)
  })
})
