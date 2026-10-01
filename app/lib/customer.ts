/**
 * Clientes do fiado (spec 06, seção 3): formatação e validação dos dados de identificação na
 * interface, rótulo para diferenciar homônimos e o aviso de nome repetido (RN-06.02). A API
 * valida de novo e guarda telefone e CPF só com dígitos.
 */
import type { components } from '../api/schema'

type Schemas = components['schemas']
export type Customer = Schemas['Customer']
export type CustomerDetail = Schemas['CustomerDetail']
export type CustomerReceivable = Schemas['CustomerReceivable']
export type Receivables = Schemas['Receivables']
export type TabCustomer = Schemas['TabCustomer']

/** RN-06.01: nome e referência até 60, observação até 140. */
export const CUSTOMER_NAME_MAX = 60
export const CUSTOMER_REFERENCE_MAX = 60
export const CUSTOMER_NOTE_MAX = 140

/** Referência que a API dá ao cliente criado para o contratante do turno (RN-06.08). */
export const CONTRACTOR_REFERENCE = 'Contratante de turno'

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Telefone brasileiro com DDD (RN-06.01): 10 dígitos (fixo) ou 11 (celular, começando com 9
 * depois do DDD). Aceita com ou sem pontuação e com o +55 na frente.
 */
export function normalizePhone(value: string): string {
  let digits = onlyDigits(value)
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2)
  return digits
}

export function isValidPhone(value: string): boolean {
  const digits = normalizePhone(value)
  if (digits.length !== 10 && digits.length !== 11) return false
  if (digits[0] === '0' || digits[1] === '0') return false
  return digits.length === 10 || digits[2] === '9'
}

/** `(11) 98765-4321` / `(11) 3456-7890`; sem formatar se não for um telefone válido. */
export function formatPhone(value: string): string {
  const digits = normalizePhone(value)
  if (digits.length === 11)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  if (digits.length === 10)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return value
}

/** CPF pelos dígitos verificadores (RN-06.01). */
export function isValidCpf(value: string): boolean {
  const digits = onlyDigits(value)
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false
  const check = (length: number) => {
    let sum = 0
    for (let index = 0; index < length; index++) {
      sum += Number(digits[index]) * (length + 1 - index)
    }
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10])
}

/** `123.456.789-09`; sem formatar se não tiver 11 dígitos. */
export function formatCpf(value: string): string {
  const digits = onlyDigits(value)
  if (digits.length !== 11) return value
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

/** CPF parcial na lista (homônimos): só o fim, como nos comprovantes. */
export function maskCpf(value: string): string {
  const digits = onlyDigits(value)
  return digits.length === 11 ? `***.***.${digits.slice(6, 9)}-${digits.slice(9)}` : value
}

/**
 * Dados de identificação de um cliente em uma linha (RN-06.02): o que diferencia homônimos na
 * busca. Vazio quando o cliente só tem o nome.
 */
export function identificationLine(customer: {
  phone?: string | null
  cpf?: string | null
  reference?: string | null
  note?: string | null
}): string {
  const parts: string[] = []
  if (customer.reference) parts.push(customer.reference)
  if (customer.phone) parts.push(formatPhone(customer.phone))
  if (customer.cpf) parts.push(`CPF ${maskCpf(customer.cpf)}`)
  if (customer.note) parts.push(customer.note)
  return parts.join(' · ')
}

/** Nome e referência, como a comanda resumida e os eventos mostram (sem telefone e CPF). */
export function customerLabel(
  customer: Pick<TabCustomer, 'name' | 'reference'> | null | undefined,
): string {
  if (!customer) return ''
  return customer.reference ? `${customer.name} (${customer.reference})` : customer.name
}

export interface CustomerFormValues {
  name: string
  phone: string
  cpf: string
  reference: string
  note: string
}

export function emptyCustomerForm(name = ''): CustomerFormValues {
  return { name, phone: '', cpf: '', reference: '', note: '' }
}

export function customerToForm(customer: Customer | CustomerDetail): CustomerFormValues {
  return {
    name: customer.name,
    phone: customer.phone ? formatPhone(customer.phone) : '',
    cpf: customer.cpf ? formatCpf(customer.cpf) : '',
    reference: customer.reference ?? '',
    note: customer.note ?? '',
  }
}

export type CustomerFormErrors = Partial<Record<keyof CustomerFormValues, string>>

/** Erros por campo, em pt-BR, para mostrar na linha reservada de cada campo. */
export function validateCustomerForm(values: CustomerFormValues): CustomerFormErrors {
  const errors: CustomerFormErrors = {}
  const name = values.name.trim()
  if (!name) errors.name = 'Informe o nome do cliente.'
  else if (name.length > CUSTOMER_NAME_MAX) errors.name = `Use até ${CUSTOMER_NAME_MAX} caracteres.`
  if (values.phone.trim() && !isValidPhone(values.phone)) {
    errors.phone = 'Telefone com DDD, ex.: (11) 98765-4321.'
  }
  if (values.cpf.trim() && !isValidCpf(values.cpf)) errors.cpf = 'CPF inválido: confira os números.'
  if (values.reference.trim().length > CUSTOMER_REFERENCE_MAX) {
    errors.reference = `Use até ${CUSTOMER_REFERENCE_MAX} caracteres.`
  }
  if (values.note.trim().length > CUSTOMER_NOTE_MAX) {
    errors.note = `Use até ${CUSTOMER_NOTE_MAX} caracteres.`
  }
  return errors
}

export function hasErrors(errors: CustomerFormErrors): boolean {
  return Object.values(errors).some(Boolean)
}

/**
 * Corpo do cadastro (`POST`) ou da edição (`PATCH`, onde `null` apaga um dado opcional).
 * Telefone e CPF vão só com dígitos.
 */
export function customerBody(values: CustomerFormValues): {
  name: string
  phone: string | null
  cpf: string | null
  reference: string | null
  note: string | null
} {
  const optional = (value: string) => (value.trim() ? value.trim() : null)
  return {
    name: values.name.trim(),
    phone: values.phone.trim() ? normalizePhone(values.phone) : null,
    cpf: values.cpf.trim() ? onlyDigits(values.cpf) : null,
    reference: optional(values.reference),
    note: optional(values.note),
  }
}

function comparableName(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function sameName(a: string, b: string): boolean {
  return comparableName(a) === comparableName(b)
}

/**
 * Aviso de homônimo (RN-06.02): cadastrar um nome que já existe sem nenhum dado de
 * identificação deixaria dois clientes impossíveis de diferenciar. Devolve os clientes com o
 * mesmo nome quando o cadastro novo não tem telefone, CPF nem referência; vazio caso contrário.
 */
export function homonymsWithoutIdentification(
  values: CustomerFormValues,
  existing: readonly Pick<Customer, 'id' | 'name'>[],
): Pick<Customer, 'id' | 'name'>[] {
  if (values.phone.trim() || values.cpf.trim() || values.reference.trim()) return []
  return existing.filter((customer) => sameName(customer.name, values.name))
}

/** Explicação dos erros de cliente da API (spec 06), para mostrar no campo ou no topo. */
export function customerErrorField(code: string | undefined): keyof CustomerFormValues | null {
  if (code === 'CUSTOMER_PHONE_TAKEN') return 'phone'
  if (code === 'CUSTOMER_CPF_TAKEN') return 'cpf'
  return null
}

export function customerErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'CUSTOMER_PHONE_TAKEN':
      return 'Já existe um cliente com este telefone nesta unidade: busque por ele.'
    case 'CUSTOMER_CPF_TAKEN':
      return 'Já existe um cliente com este CPF nesta unidade: busque por ele.'
    case 'CUSTOMER_REMOVED':
      return 'Este cliente foi removido e não pode mais ser usado.'
    case 'CUSTOMER_CHANGED':
      return 'Outra pessoa alterou este cliente agora. Confira os dados e salve de novo.'
    case 'INVALID_CUSTOMER':
      return 'Este cliente não é desta unidade ou foi removido. Escolha outro.'
    case 'CUSTOMER_REQUIRED':
      return 'Escolha o cliente para pendurar.'
    case 'NO_SHIFT_OPEN':
      return 'Quitar fiado exige um turno aberto na unidade: abra o turno e um caixa para receber.'
    default:
      return fallback
  }
}

/** RN-06.03: por que o cliente não pode ser removido, com o valor que ainda deve. */
export function receivableBlockMessage(balanceCents: number | null, format: (c: number) => string) {
  const value = balanceCents !== null ? ` (${format(balanceCents)})` : ''
  return `Este cliente ainda tem fiado a receber${value}. Quite as comandas antes de remover: o valor a receber não pode sumir.`
}
