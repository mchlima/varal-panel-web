import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// CA-08.01: todos os pares de cor de texto e fundo dos tokens passam AA (4,5:1).

const css = readFileSync(
  fileURLToPath(new URL('../../app/assets/css/tokens.css', import.meta.url)),
  'utf8',
)

const tokens = new Map(
  [...css.matchAll(/--(color-[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(([, name, value]) => [
    name!,
    value!,
  ]),
)

function token(name: string): string {
  const value = tokens.get(name)
  if (!value) throw new Error(`token ausente: --${name}`)
  return value
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

const pairs: [text: string, background: string][] = [
  ['color-primary-ink', 'color-primary'],
  ['color-primary-deep', 'color-primary-soft'],
  ['color-primary-deep', 'color-surface'],
  ['color-primary-deep', 'color-bg'],
  ['color-text', 'color-bg'],
  ['color-text', 'color-surface'],
  ['color-text', 'color-surface-muted'],
  ['color-text', 'color-primary-soft'],
  ['color-text-muted', 'color-surface'],
  ['color-text-muted', 'color-surface-muted'],
  ['color-text-muted', 'color-bg'],
  ['color-error', 'color-surface'],
  ['color-status-new-text', 'color-status-new-bg'],
  ['color-status-preparing-text', 'color-status-preparing-bg'],
  ['color-status-ready-text', 'color-status-ready-bg'],
  ['color-status-late-text', 'color-status-late-bg'],
  ['color-status-canceled-text', 'color-status-canceled-bg'],
  // Faixa do "entrar como" (spec 02, RN-02.19): fundo escuro, texto claro.
  ['color-surface', 'color-text'],
]

describe('tokens de cor (spec 08)', () => {
  it.each(pairs)('CA-08.01: --%s sobre --%s tem contraste AA', (text, background) => {
    expect(contrast(token(text), token(background))).toBeGreaterThanOrEqual(4.5)
  })
})
