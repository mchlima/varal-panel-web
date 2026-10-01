/**
 * Dinheiro (regras comuns: sempre inteiro em centavos; nunca `float`). A tela mostra e
 * recebe reais ("12,50"); a API guarda e devolve centavos (`priceCents`).
 */

/** Maior valor aceito pelos campos (R$ 99.999,99), bem abaixo do inteiro de 32 bits. */
export const MAX_CENTS = 9_999_999

/**
 * `1250` → `"R$ 12,50"` (com espaço não separável), montado só com inteiros: os reais com
 * ponto de milhar e os centavos com dois dígitos.
 */
export function formatCents(cents: number): string {
  const abs = Math.abs(Math.trunc(cents))
  const reais = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const rest = String(abs % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}R$\u00a0${reais},${rest}`
}

/** Acréscimo de modificador: `0` → `"sem acréscimo"`, `300` → `"+ R$ 3,00"`. */
export function formatDelta(cents: number): string {
  return cents === 0 ? 'sem acréscimo' : `+ ${formatCents(cents)}`
}

/** `1250` → `"12,50"`, para preencher o campo de reais. */
export function centsToInput(cents: number): string {
  const abs = Math.abs(Math.trunc(cents))
  const reais = Math.trunc(abs / 100)
  const rest = String(abs % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}${reais},${rest}`
}

/**
 * Lê um valor em reais digitado e devolve centavos, sem passar por ponto flutuante.
 * Aceita "12", "12,5", "12,50", "1.234,56", "R$ 12,00" e "12.50" (ponto seguido de 1 ou 2
 * dígitos no fim é decimal). Devolve `null` se não for um valor válido, negativo
 * (RN-03.09: preço ≥ 0) ou acima de `MAX_CENTS`.
 */
export function parseReais(input: string): number | null {
  let text = input.replace(/\s/g, '').replace(/^R\$/i, '')
  if (!text) return null
  if (!/^[\d.,]+$/.test(text)) return null

  if (text.includes(',')) {
    // Vírgula decimal: pontos são separadores de milhar.
    if (text.indexOf(',') !== text.lastIndexOf(',')) return null
    const [intPart, decPart] = text.split(',') as [string, string]
    if (intPart.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(intPart)) return null
    text = `${intPart.replace(/\./g, '')}.${decPart}`
  } else if (/\.\d{1,2}$/.test(text) && text.indexOf('.') === text.lastIndexOf('.')) {
    // "12.5" ou "12.50": ponto decimal.
  } else if (text.includes('.')) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(text)) return null
    text = text.replace(/\./g, '')
  }

  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(text)
  if (!match) return null
  const [, intDigits = '', decDigits = ''] = match
  if (!intDigits && !decDigits) return null
  const cents = Number(intDigits || '0') * 100 + Number(decDigits.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null
  return cents
}
