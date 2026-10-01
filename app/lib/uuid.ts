/**
 * UUID v7 (RFC 9562): 48 bits de milissegundos + bits aleatórios. Ordenável no tempo,
 * como os ids da API. Usado no `deviceId` e nas `Idempotency-Key` da fila offline.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  // 48 bits de timestamp em big-endian.
  let ms = Math.max(0, Math.floor(now))
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256
    ms = Math.floor(ms / 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70 // versão 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // variante RFC 4122

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}
