/**
 * Fechamento e caixa (spec 05): formas de pagamento, troco, desconto, paga antes e conferência
 * do caixa. Tudo puro (sem Vue) e sempre em centavos inteiros, para ser testado sozinho.
 */
import type { components } from '../api/schema'
import { MAX_CENTS, formatCents } from './money'

type Schemas = components['schemas']
export type PaymentMethod = Schemas['PaymentMethod']
export type Payment = Schemas['Payment']
export type PaymentResult = Schemas['PaymentResult']
export type DiscountType = Schemas['DiscountType']
export type CashRegister = Schemas['CashRegister']
export type CashRegisterSession = Schemas['CashRegisterSession']
export type CashRegisterSessionDetail = Schemas['CashRegisterSessionDetail']
export type CashRegisterClosePreview = Schemas['CashRegisterClosePreview']
export type CashRegisterCount = Schemas['CashRegisterCount']
export type CashMovement = Schemas['CashMovement']
export type CashMovementType = Schemas['CashMovementType']
export type ActorRef = Schemas['ActorRef']
export type PayFirstBody = Schemas['PayFirstRequestInput']
export type PayFirstPaymentInput = Schemas['PayFirstPaymentInput']
export type CreatePaymentBody = Schemas['CreatePaymentRequestInput']
export type EventCashRegisterOpened = Schemas['EventCashRegisterOpened']
export type EventCashRegisterUpdated = Schemas['EventCashRegisterUpdated']
export type EventCashRegisterClosed = Schemas['EventCashRegisterClosed']

/** RN-05.04, na ordem da conferência do caixa (spec 05, seção 5). */
export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'cash',
  'pix',
  'credit_card',
  'debit_card',
]

/** Ordem dos botões grandes da tela de receber (spec 05, seção 8). */
export const RECEIVE_METHODS: readonly PaymentMethod[] = [
  'pix',
  'cash',
  'credit_card',
  'debit_card',
]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  credit_card: 'Crédito',
  debit_card: 'Débito',
}

/** "no Pix", "no dinheiro", "no crédito", "no débito". */
const METHOD_PREPOSITION: Record<PaymentMethod, string> = {
  pix: 'no Pix',
  cash: 'no dinheiro',
  credit_card: 'no crédito',
  debit_card: 'no débito',
}

/** Onde o valor é conferido no fechamento (spec 05, tabela da seção 5). */
export const COUNT_HINTS: Record<PaymentMethod, string> = {
  cash: 'Contado na gaveta',
  pix: 'Conferido no extrato',
  credit_card: 'Total da maquininha',
  debit_card: 'Total da maquininha',
}

export const CASH_MOVEMENT_LABELS: Record<CashMovementType, string> = {
  withdrawal: 'Sangria',
  deposit: 'Suprimento',
}

/** Limites da spec 05 (RN-05.01, RN-05.18, RN-05.20). */
export const REASON_MAX = 140
export const CLOSING_NOTE_MAX = 500
export const REGISTER_NAME_MAX = 40

/**
 * Spec 08, seção 6 ("Botão de confirmação de valor"): mostra valor e forma para evitar erro de
 * toque. `Confirmar R$ 46,00 no Pix`.
 */
export function confirmPaymentLabel(method: PaymentMethod, cents: number): string {
  return `Confirmar ${formatCents(cents)} ${METHOD_PREPOSITION[method]}`
}

/** Paga antes com mais de uma forma: "Adicionar R$ 20,00 no Pix" (ainda não envia). */
export function addPaymentLabel(method: PaymentMethod, cents: number): string {
  return `Adicionar ${formatCents(cents)} ${METHOD_PREPOSITION[method]}`
}

/**
 * RN-05.09 (CA-05.02): no dinheiro, aplica-se o menor entre o entregue e o saldo; o troco é a
 * diferença. Ex.: saldo 46,00, entregue 50,00 → aplicado 46,00 e troco 4,00.
 */
export function cashChange(
  tenderedCents: number,
  balanceCents: number,
): { appliedCents: number; changeCents: number } {
  const balance = Math.max(0, balanceCents)
  const applied = Math.min(Math.max(0, tenderedCents), balance)
  return { appliedCents: applied, changeCents: Math.max(0, tenderedCents - applied) }
}

/**
 * Valor que a tela vai registrar e o problema que impede confirmar, se houver (RN-05.08: Pix e
 * cartões nunca passam do saldo; dinheiro aplica até o saldo e devolve troco).
 */
export function paymentIssue(
  method: PaymentMethod,
  cents: number,
  balanceCents: number,
): string | null {
  if (balanceCents <= 0) return 'Não há saldo a receber.'
  if (cents <= 0) return method === 'cash' ? 'Digite o valor entregue.' : 'Digite o valor.'
  if (cents > MAX_CENTS) return 'Valor alto demais.'
  if (method !== 'cash' && cents > balanceCents) {
    return `No ${PAYMENT_METHOD_LABELS[method]}, o valor não pode passar do saldo (${formatCents(balanceCents)}).`
  }
  return null
}

/**
 * Teclado numérico de valores: os dígitos entram pela direita, em centavos ("4", "6", "0", "0"
 * → R$ 46,00), sem ponto flutuante. `00` acrescenta dois zeros; `back` apaga o último dígito.
 */
export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | 'back'

export function pressKey(cents: number, key: KeypadKey): number {
  if (key === 'back') return Math.trunc(cents / 10)
  const next = key === '00' ? cents * 100 : cents * 10 + Number(key)
  return next > MAX_CENTS ? cents : next
}

/**
 * RN-05.03 (CA-05.04): o desconto percentual é calculado sobre o subtotal e arredondado para
 * baixo em centavos; o total nunca fica negativo. `value` é centavos (`amount`) ou 1 a 100
 * (`percent`).
 */
export function discountCents(subtotalCents: number, type: DiscountType, value: number): number {
  const subtotal = Math.max(0, subtotalCents)
  if (value <= 0) return 0
  if (type === 'percent') {
    const percent = Math.min(100, Math.trunc(value))
    return Math.floor((subtotal * percent) / 100)
  }
  return Math.min(subtotal, Math.trunc(value))
}

export function discountedTotal(subtotalCents: number, type: DiscountType, value: number): number {
  return Math.max(0, subtotalCents - discountCents(subtotalCents, type, value))
}

/** Texto do desconto atual: "10%" ou "R$ 5,00". */
export function discountLabel(type: DiscountType | null, value: number | null): string {
  if (!type || value === null) return ''
  return type === 'percent' ? `${value}%` : formatCents(value)
}

/** Pagamento ainda valendo (não estornado, RN-05.15). */
export function isActivePayment(payment: Pick<Payment, 'reversedAt'>): boolean {
  return payment.reversedAt === null
}

/** Pagamento informado na montagem da comanda paga antes (ainda não enviado). */
export interface DraftPayment {
  method: PaymentMethod
  /** Pix e cartões: o valor. Dinheiro: o valor entregue. */
  cents: number
}

export interface DraftPaymentLine extends DraftPayment {
  appliedCents: number
  changeCents: number
}

/**
 * Paga antes (RN-05.12, CA-05.09): aplica os pagamentos na ordem, como a API. Pix e cartões
 * aplicam o valor (até o que falta), dinheiro aplica até o que falta e o resto é troco. Devolve
 * quanto ainda falta (`remainingCents`) e se a soma cobre o total.
 */
export function applyDraftPayments(
  totalCents: number,
  payments: readonly DraftPayment[],
): { lines: DraftPaymentLine[]; remainingCents: number; changeCents: number; covered: boolean } {
  let remaining = Math.max(0, totalCents)
  let change = 0
  const lines: DraftPaymentLine[] = []
  for (const payment of payments) {
    if (payment.method === 'cash') {
      const result = cashChange(payment.cents, remaining)
      lines.push({ ...payment, ...result })
      remaining -= result.appliedCents
      change += result.changeCents
    } else {
      const applied = Math.min(payment.cents, remaining)
      lines.push({ ...payment, appliedCents: applied, changeCents: 0 })
      remaining -= applied
    }
  }
  return { lines, remainingCents: remaining, changeCents: change, covered: remaining === 0 }
}

/** Corpo do `POST /units/{id}/tabs/pay-first` (RN-05.12). */
export function toPayFirstBody(input: {
  customerName: string
  items: PayFirstBody['items']
  payments: readonly DraftPayment[]
  cashRegisterId?: string | null
}): PayFirstBody {
  const body: PayFirstBody = {
    customerName: input.customerName,
    items: input.items,
    payments: input.payments.map((payment) =>
      payment.method === 'cash'
        ? { method: 'cash', tenderedCents: payment.cents }
        : { method: payment.method, amountCents: payment.cents },
    ),
  }
  if (input.cashRegisterId) body.cashRegisterId = input.cashRegisterId
  return body
}

/** Corpo do `POST /tabs/{id}/payments` (RN-05.05, RN-05.09). */
export function toPaymentBody(
  method: PaymentMethod,
  cents: number,
  cashRegisterId: string | null,
): CreatePaymentBody {
  const body: CreatePaymentBody =
    method === 'cash' ? { method, tenderedCents: cents } : { method, amountCents: cents }
  if (cashRegisterId) body.cashRegisterId = cashRegisterId
  return body
}

/** Esperado de uma forma no caixa (RN-05.19 para o dinheiro). */
export function expectedOf(
  register: Pick<CashRegisterSession, 'expected'>,
  method: PaymentMethod,
): number {
  return register.expected.find((entry) => entry.method === method)?.expectedCents ?? 0
}

/**
 * Esperado de uma forma separado em vendas e quitações de fiado (RN-05.22): as
 * quitações entram no caixa em que foram recebidas, mas aparecem à parte na conferência.
 */
export function expectedSplit(
  register: Pick<CashRegisterSession, 'expected'>,
  method: PaymentMethod,
): { salesCents: number; creditSettlementsCents: number } {
  const entry = register.expected.find((item) => item.method === method)
  return {
    salesCents: entry?.salesCents ?? 0,
    creditSettlementsCents: entry?.creditSettlementsCents ?? 0,
  }
}

/** "vendas R$ 30,00 · fiado R$ 60,00" (RN-05.22). */
export function splitLabel(split: { salesCents: number; creditSettlementsCents: number }): string {
  return `vendas ${formatCents(split.salesCents)} · quitações de fiado ${formatCents(split.creditSettlementsCents)}`
}

export interface CountRow {
  method: PaymentMethod
  expectedCents: number
  /** `null` enquanto o campo estiver vazio ou inválido. */
  informedCents: number | null
  /** Informado − esperado (RN-05.20); `null` sem valor informado. */
  differenceCents: number | null
}

/**
 * Conferência do fechamento (RN-05.20, CA-05.07): para cada uma das 4 formas, o esperado, o
 * informado e a diferença (informado − esperado), calculada ao vivo.
 */
export function closingRows(
  register: Pick<CashRegisterSession, 'expected'>,
  informed: Partial<Record<PaymentMethod, number | null>>,
): CountRow[] {
  return PAYMENT_METHODS.map((method) => {
    const expected = expectedOf(register, method)
    const value = informed[method]
    const informedCents = typeof value === 'number' ? value : null
    return {
      method,
      expectedCents: expected,
      informedCents,
      differenceCents: informedCents === null ? null : informedCents - expected,
    }
  })
}

/** Alguma forma tem diferença diferente de zero: a observação vira obrigatória (RN-05.20). */
export function hasDifference(rows: readonly Pick<CountRow, 'differenceCents'>[]): boolean {
  return rows.some((row) => row.differenceCents !== null && row.differenceCents !== 0)
}

/** "Confere", "Sobra R$ 2,00", "Falta R$ 5,00": diferença sempre com texto, não só cor. */
export function differenceLabel(differenceCents: number): string {
  if (differenceCents === 0) return 'Confere'
  return differenceCents > 0
    ? `Sobra ${formatCents(differenceCents)}`
    : `Falta ${formatCents(-differenceCents)}`
}

/** `details.counts` de `CLOSING_NOTE_REQUIRED` (prévia das diferenças). */
export function countsOf(details: Record<string, unknown> | undefined): CashRegisterCount[] {
  return Array.isArray(details?.counts) ? (details.counts as CashRegisterCount[]) : []
}

/** `details.cashRegisters` de `CASH_REGISTER_REQUIRED` (RN-05.05). */
export function registersOf(
  details: Record<string, unknown> | undefined,
): { id: string; name: string }[] {
  return Array.isArray(details?.cashRegisters)
    ? (details.cashRegisters as { id: string; name: string }[])
    : []
}

/** `details.paymentIds` de `TAB_PAID` e `TAB_HAS_PAYMENTS` (RN-05.14). */
export function paymentIdsOf(details: Record<string, unknown> | undefined): string[] {
  return Array.isArray(details?.paymentIds) ? (details.paymentIds as string[]) : []
}

/**
 * Quem fez a ação (RN-05.17: responsável pelo caixa). A API manda só tipo e id; o nome vem do
 * `/auth/me` (eu) ou da lista de colaboradores, quando a tela tem.
 */
export function actorLabel(
  actor: ActorRef,
  me: { type: 'owner' | 'staff'; id: string } | null,
  staffNames: Record<string, string> = {},
): string {
  if (me && actor.type === me.type && actor.id === me.id) return 'Você'
  if (actor.type === 'owner') return 'Dono'
  if (actor.type === 'staff' && actor.id && staffNames[actor.id]) return staffNames[actor.id]!
  return 'Colaborador'
}

/** Abertura em andamento do caixa, ou `null` (caixa fechado ou nunca aberto). */
export function openSessionOf(register: Pick<CashRegister, 'session'>): CashRegisterSession | null {
  return register.session?.status === 'open' ? register.session : null
}

/** Caixas com abertura em andamento, na ordem do cadastro (RN-05.05). */
export function openRegisters<T extends Pick<CashRegister, 'session' | 'sortOrder'>>(
  registers: readonly T[],
): T[] {
  return registers
    .filter((register) => register.session?.status === 'open')
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Situação de um caixa cadastrado para a tela (spec 05, seção 5.1). */
export type RegisterState = 'open' | 'closed' | 'never' | 'inactive'

export function registerState(register: Pick<CashRegister, 'active' | 'session'>): RegisterState {
  if (register.session?.status === 'open') return 'open'
  if (!register.active) return 'inactive'
  return register.session ? 'closed' : 'never'
}

export const REGISTER_STATE_LABELS: Record<RegisterState, string> = {
  open: 'Aberto',
  closed: 'Fechado',
  never: 'Nunca aberto',
  inactive: 'Desativado',
}

/**
 * O que fazer quando a API recusa uma ação de caixa (spec 05; RN-05.17, RN-05.23, RN-05.24,
 * RN-05.27). Complementa a `message` da API, que já vem em pt-BR.
 */
export function cashRegisterHint(code: string | undefined): string | undefined {
  switch (code) {
    case 'LAST_ACTIVE_CASH_REGISTER':
      return 'Cadastre ou ative outro caixa antes de desativar este.'
    case 'CASH_REGISTER_OPEN':
      return 'Feche o caixa antes de desativá-lo.'
    case 'CASH_REGISTER_NAME_TAKEN':
      return 'Já existe um caixa com esse nome nesta unidade. Use outro nome, como "Caixa 2".'
    case 'CASH_REGISTER_ALREADY_OPEN':
      return 'Este caixa já foi aberto, talvez em outro aparelho. Volte aos caixas para ver quem abriu.'
    case 'CASH_REGISTER_INACTIVE':
      return 'Este caixa está desativado. Ative-o em Unidades → Caixas ou abra outro.'
    case 'CASH_REGISTER_CLOSED':
      return 'Este caixa já foi fechado. Para voltar a vender, abra o caixa de novo.'
    case 'ORGANIZATION_SUSPENDED':
      return 'Com a assinatura suspensa, não dá para abrir caixa. Fale com o suporte do Varal.'
    case 'UNIT_INACTIVE':
      return 'A unidade está desativada. Ative-a em Unidades para abrir o caixa.'
    case 'CLOSING_NOTE_REQUIRED':
      return 'Há diferença entre o conferido e o esperado: explique na observação.'
    case 'VERSION_CONFLICT':
      return 'Entrou pagamento ou movimento neste caixa enquanto você conferia. Confira de novo os valores.'
    default:
      return undefined
  }
}

/** Corpo do `POST /cash-register-sessions/{id}/close` (RN-05.20, RN-05.29). */
export function toCloseBody(input: {
  informed: Partial<Record<PaymentMethod, number | null>>
  note: string
  lastOpenRegister: boolean
  finishPendingItems: boolean
  finishEvent: boolean
  version?: number
}): Schemas['CloseCashRegisterRequestInput'] {
  const note = input.note.trim()
  return {
    counts: PAYMENT_METHODS.map((method) => ({
      method,
      informedCents: input.informed[method] ?? 0,
    })),
    ...(note ? { note } : {}),
    // Só no último caixa aberto a API leva o preparo à etapa final e encerra o evento.
    finishPendingItems: input.lastOpenRegister ? input.finishPendingItems : false,
    finishEvent: input.lastOpenRegister ? input.finishEvent : false,
    ...(input.version !== undefined ? { version: input.version } : {}),
  }
}
