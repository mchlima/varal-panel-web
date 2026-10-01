/** Leitura e escrita no localStorage que nunca lançam (modo privado, armazenamento bloqueado). */
export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Sem armazenamento: o valor vale só nesta aba.
  }
}

/**
 * Pede armazenamento persistente (plano 2.3): sem ele, o Safari apaga os dados de sites
 * não instalados depois de 7 dias sem uso, e a fila offline iria junto.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
