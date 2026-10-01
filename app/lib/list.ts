/** Move um item da lista de `from` para `to`, devolvendo uma lista nova. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list]
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length || from === to) return copy
  const [item] = copy.splice(from, 1) as [T]
  copy.splice(to, 0, item)
  return copy
}

/** Mesmos ids na mesma ordem. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}
