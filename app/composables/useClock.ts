/**
 * Relógio da tela, em milissegundos, atualizado a cada `intervalMs`. Atrasos (RN-04.23) e o
 * tempo desde o pedido são recalculados com ele, sem esperar a API.
 */
export function useClock(intervalMs = 15_000): Ref<number> {
  const now = ref(Date.now())
  const timer = setInterval(() => {
    now.value = Date.now()
  }, intervalMs)
  onScopeDispose(() => clearInterval(timer))
  return now
}
