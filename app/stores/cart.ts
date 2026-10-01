import { defineStore } from 'pinia'
import { readLocal, writeLocal } from '~/lib/browser'
import type { OrderItemRejection } from '~/lib/operation'
import {
  addLine,
  lineKey,
  normalizeNote,
  setLineQuantity,
  type CartLine,
} from '~/lib/order-builder'

const STORAGE_KEY = 'varal.carts'

export interface Cart {
  lines: CartLine[]
  /** Recusas da última tentativa (`ORDER_REJECTED`, RN-04.17), por chave de linha. */
  rejections: Record<string, OrderItemRejection[]>
}

function readCarts(): Record<string, Cart> {
  const raw = readLocal(STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, Cart>
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Pedido sendo montado em cada comanda (spec 04, seção 8.1). Fica neste aparelho até ser
 * enviado: sair da tela, recarregar ou perder a rede não perde o que já foi escolhido.
 */
export const useCartStore = defineStore('cart', () => {
  const carts = ref<Record<string, Cart>>(readCarts())

  function persist() {
    const entries = Object.entries(carts.value).filter(([, cart]) => cart.lines.length > 0)
    writeLocal(STORAGE_KEY, entries.length ? JSON.stringify(Object.fromEntries(entries)) : null)
  }

  function cartOf(tabId: string): Cart {
    return carts.value[tabId] ?? { lines: [], rejections: {} }
  }

  function update(tabId: string, change: (cart: Cart) => Cart) {
    carts.value = { ...carts.value, [tabId]: change(cartOf(tabId)) }
    persist()
  }

  function add(tabId: string, line: CartLine) {
    update(tabId, (cart) => ({ ...cart, lines: addLine(cart.lines, line) }))
  }

  function setQuantity(tabId: string, key: string, quantity: number) {
    update(tabId, (cart) => {
      const { [key]: _removed, ...others } = cart.rejections
      const rejections = quantity <= 0 ? others : cart.rejections
      return { lines: setLineQuantity(cart.lines, key, quantity), rejections }
    })
  }

  /** Troca a observação de uma linha (junta com outra igual, se houver). */
  function setNote(tabId: string, key: string, note: string) {
    update(tabId, (cart) => {
      const line = cart.lines.find((item) => item.key === key)
      if (!line) return cart
      const clean = normalizeNote(note)
      const changed = { ...line, note: clean, key: lineKey(line.productId, line.modifiers, clean) }
      const others = cart.lines.filter((item) => item.key !== key)
      const index = cart.lines.findIndex((item) => item.key === key)
      if (others.some((item) => item.key === changed.key)) {
        return { ...cart, lines: addLine(others, changed) }
      }
      const lines = [...cart.lines]
      lines.splice(index, 1, changed)
      return { ...cart, lines }
    })
  }

  function setRejections(tabId: string, rejections: Record<string, OrderItemRejection[]>) {
    update(tabId, (cart) => ({ ...cart, rejections }))
  }

  /** Volta um pedido recusado ao carrinho para corrigir (as linhas que o usuário já tinha). */
  function restore(
    tabId: string,
    lines: CartLine[],
    rejections: Record<string, OrderItemRejection[]>,
  ) {
    update(tabId, (cart) => {
      let merged = cart.lines
      for (const line of lines) merged = addLine(merged, line)
      return { lines: merged, rejections: { ...cart.rejections, ...rejections } }
    })
  }

  function clear(tabId: string) {
    const { [tabId]: _removed, ...rest } = carts.value
    carts.value = rest
    persist()
  }

  return { carts, cartOf, add, setQuantity, setNote, setRejections, restore, clear }
})
