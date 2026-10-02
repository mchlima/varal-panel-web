/**
 * Início do painel orientado à tarefa (spec 01, seção 14.2; RN-01.24): a partir da situação da
 * operação (`GET /units/{id}/operation`), qual é a próxima ação óbvia da unidade. Regras puras,
 * testadas sozinhas.
 */
import type { CashRegister } from './payment'
import { openRegisters } from './payment'
import { sinceLabel, type UnitOperation } from './operation'

export type HomeAction =
  /** Caixa aberto desde um dia anterior (RN-05.26): fechar antes de tudo. */
  | { kind: 'close-earlier'; register: CashRegister; since: string }
  /** Caixa aberto: vender. */
  | { kind: 'open-counter'; registers: CashRegister[] }
  /** Nenhum caixa aberto: abrir o caixa (um cadastrado vai direto à abertura dele). */
  | { kind: 'open-cash'; target: string }

export function homeAction(operation: UnitOperation, now: number = Date.now()): HomeAction {
  const open = openRegisters(operation.cashRegisters)
  const earlier = open.find((register) => register.session?.openSinceEarlierDay)
  if (earlier) {
    return {
      kind: 'close-earlier',
      register: earlier,
      since: sinceLabel(earlier.session!.openedAt, now),
    }
  }
  if (open.length > 0) return { kind: 'open-counter', registers: open }
  return { kind: 'open-cash', target: openCashTarget(operation.cashRegisters) }
}

/** "Abrir caixa": com um caixa ativo, a abertura dele; com mais, a lista (spec 05, seção 8). */
export function openCashTarget(registers: readonly Pick<CashRegister, 'id' | 'active'>[]): string {
  const active = registers.filter((register) => register.active)
  return active.length === 1 ? `/caixas/${active[0]!.id}/abrir` : '/caixas'
}

/** "Fechar caixa": com um caixa aberto, o fechamento dele; com mais, a lista. */
export function closeCashTarget(registers: readonly CashRegister[]): string {
  const open = openRegisters(registers)
  return open.length === 1 ? `/caixas/${open[0]!.id}/fechar` : '/caixas'
}

/** Resumo de uma linha por unidade, para quem tem mais de uma ("Centro: caixa aberto"). */
export function unitStatusLabel(operation: UnitOperation | null): string {
  if (!operation) return 'carregando…'
  const open = openRegisters(operation.cashRegisters)
  if (open.length === 0) return 'caixa fechado'
  if (open.some((register) => register.session?.openSinceEarlierDay)) {
    return 'caixa aberto desde outro dia'
  }
  return open.length === 1 ? 'caixa aberto' : `${open.length} caixas abertos`
}

/** "1 comanda", "3 comandas". */
export function tabsCountLabel(count: number): string {
  return count === 1 ? '1 comanda' : `${count} comandas`
}
