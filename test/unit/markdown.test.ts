import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, safeHref } from '../../app/lib/markdown'

describe('markdown simples dos comunicados (RN-02.13, RN-02.16)', () => {
  it('parágrafos, títulos e listas', () => {
    const blocks = parseMarkdown(
      '# Novidade\n\nPrimeira linha\nsegunda linha\n\n- um\n- dois\n\n1. a\n2. b',
    )
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list'])
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', text: 'Primeira linha' },
        { type: 'br' },
        { type: 'text', text: 'segunda linha' },
      ],
    })
    expect(blocks[2]).toMatchObject({ type: 'list', ordered: false })
    expect(blocks[3]).toMatchObject({ type: 'list', ordered: true })
  })

  it('negrito, itálico, código e link', () => {
    expect(parseInline('**forte** e *leve* e `x` e [site](https://varal.app/a)')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'forte' }] },
      { type: 'text', text: ' e ' },
      { type: 'em', children: [{ type: 'text', text: 'leve' }] },
      { type: 'text', text: ' e ' },
      { type: 'code', text: 'x' },
      { type: 'text', text: ' e ' },
      { type: 'link', href: 'https://varal.app/a', children: [{ type: 'text', text: 'site' }] },
    ])
  })

  it('HTML cru continua texto: nunca vira elemento', () => {
    const blocks = parseMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '<script>alert(1)</script> <img src=x onerror=alert(1)>' },
        ],
      },
    ])
  })

  it('links só com http, https e mailto; os outros ficam só com o texto', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,<b>x</b>')).toBeNull()
    expect(safeHref('/relativo')).toBeNull()
    expect(safeHref('mailto:ajuda@varal.app')).toBe('mailto:ajuda@varal.app')
    expect(parseInline('[clique](javascript:alert(1))')).toEqual([
      { type: 'text', text: 'clique' },
      { type: 'text', text: ')' },
    ])
  })

  it('marcadores sem par e escapes aparecem como texto', () => {
    expect(parseInline('2 * 3 = 6 e \\*literal\\*')).toEqual([
      { type: 'text', text: '2 * 3 = 6 e *literal*' },
    ])
  })
})
