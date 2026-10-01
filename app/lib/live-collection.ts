/**
 * Coleções atualizadas em tempo real (spec 01, seção 10; RN-01.05): o REST é a fonte da
 * verdade; eventos só complementam e são ignorados quando trazem `version` menor ou igual à
 * conhecida. Cada coleção lembra a última versão de cada registro, inclusive dos que saíram
 * (um evento atrasado não ressuscita um item que já foi para outra estação).
 *
 * Durante a busca por REST, os eventos que chegam ficam guardados e são aplicados depois,
 * por cima do estado recarregado (README da API, "Reconexão").
 */
import type { OrderItem, TabSummary } from './operation'

interface Versioned {
  id: string
  version: number
}

export class LiveCollection<T extends Versioned> {
  items: Record<string, T> = {}
  versions: Record<string, number> = {}
  private buffering = false
  private buffer: (() => void)[] = []

  constructor(private readonly belongs: (record: T) => boolean) {}

  /** Mais novo que o conhecido? (`version` igual é o mesmo estado: ignorado.) */
  isNewer(record: Versioned): boolean {
    const known = this.versions[record.id]
    return known === undefined || record.version > known
  }

  /**
   * Aplica um registro vindo de evento ou de resposta de ação. Devolve `true` se mudou algo.
   * Se ele não pertence mais a esta coleção (outra estação, comanda fechada), sai dela.
   */
  apply(record: T): boolean {
    if (this.buffering) {
      this.buffer.push(() => this.apply(record))
      return false
    }
    if (!this.isNewer(record)) return false
    this.versions[record.id] = record.version
    if (this.belongs(record)) {
      this.items[record.id] = record
    } else if (record.id in this.items) {
      this.drop(record.id)
    }
    return true
  }

  /** Tira um registro (ex.: saiu da fila), lembrando a versão para eventos atrasados. */
  remove(id: string, version: number): boolean {
    if (this.buffering) {
      this.buffer.push(() => this.remove(id, version))
      return false
    }
    const known = this.versions[id]
    if (known !== undefined && version <= known) return false
    this.versions[id] = version
    if (!(id in this.items)) return false
    this.drop(id)
    return true
  }

  private drop(id: string): void {
    const { [id]: _removed, ...rest } = this.items
    this.items = rest as Record<string, T>
  }

  /** Começa uma busca por REST: eventos passam a ser guardados. */
  beginReload(): void {
    this.buffering = true
  }

  /** Troca o estado pelo do REST e aplica os eventos guardados durante a busca. */
  finishReload(records: readonly T[]): void {
    const items: Record<string, T> = {}
    const versions = { ...this.versions }
    for (const record of records) {
      versions[record.id] = record.version
      if (this.belongs(record)) items[record.id] = record
    }
    this.items = items
    this.versions = versions
    this.buffering = false
    const pending = this.buffer
    this.buffer = []
    for (const replay of pending) replay()
  }

  /** A busca falhou: volta a aplicar eventos e descarta nada do que tinha. */
  abortReload(): void {
    this.buffering = false
    const pending = this.buffer
    this.buffer = []
    for (const replay of pending) replay()
  }

  get reloading(): boolean {
    return this.buffering
  }

  list(): T[] {
    return Object.values(this.items)
  }

  clear(): void {
    this.items = {}
    this.versions = {}
    this.buffer = []
    this.buffering = false
  }
}

/** Fila de uma estação (spec 04, seção 8.2): itens ativos com `stationId` igual ao dela. */
export function createStationQueue(stationId: string): LiveCollection<OrderItem> {
  return new LiveCollection<OrderItem>(
    (item) => item.stationId === stationId && item.canceledAt === null,
  )
}

/** Varal de comandas (spec 04, seção 8.1): comandas `open` e `closing` do turno. */
export function createTabBoard(shiftId: string): LiveCollection<TabSummary> {
  return new LiveCollection<TabSummary>(
    (tab) => tab.shiftId === shiftId && (tab.status === 'open' || tab.status === 'closing'),
  )
}

/**
 * Ordem da fila: pedido mais antigo primeiro, itens do mesmo pedido juntos (spec 04, seção
 * 8.2); dentro do pedido, a ordem de criação das linhas (ids UUID v7).
 */
export function compareQueueItems(a: OrderItem, b: OrderItem): number {
  return (
    Date.parse(a.sentAt) - Date.parse(b.sentAt) ||
    a.orderId.localeCompare(b.orderId) ||
    (a.splitFromId ?? a.id).localeCompare(b.splitFromId ?? b.id) ||
    a.id.localeCompare(b.id)
  )
}

/**
 * Comanda aberta na tela (spec 04, seção 8.1): aplica um item vindo de evento ou de resposta de
 * ação no pedido dele, se for mais novo. Linhas novas de divisão (RN-04.24, RN-04.26) entram
 * logo depois da original. Devolve `true` se mudou algo.
 */
export function applyItemToTab(
  tab: { id: string; orders: { id: string; items: OrderItem[] }[] },
  item: OrderItem,
): boolean {
  if (item.tabId !== tab.id) return false
  const order = tab.orders.find((candidate) => candidate.id === item.orderId)
  if (!order) return false
  const index = order.items.findIndex((candidate) => candidate.id === item.id)
  if (index >= 0) {
    if (item.version <= order.items[index]!.version) return false
    order.items.splice(index, 1, item)
    return true
  }
  const origin = item.splitFromId
    ? order.items.findIndex((candidate) => candidate.id === item.splitFromId)
    : -1
  if (origin >= 0) order.items.splice(origin + 1, 0, item)
  else order.items.push(item)
  return true
}
