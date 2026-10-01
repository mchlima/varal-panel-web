import { describe, expect, it } from 'vitest'
import {
  addLine,
  buildLine,
  cartIssue,
  cartTotalCents,
  chosenModifiers,
  effectivePriceCents,
  lineTotalCents,
  needsOptions,
  rejectionsByLine,
  selectionIssues,
  setLineQuantity,
  toOrderBody,
  toggleModifier,
  unavailableLines,
  visibleGroups,
  type Selection,
} from '../../app/lib/order-builder'
import { skewer } from '../support/operation-fixtures'

const product = skewer()
const groups = visibleGroups(product)
const point = groups[0]!
const sides = groups[1]!

describe('montagem do pedido: modificadores (RN-03.13, CA-03.06)', () => {
  it('mostra só as opções ativas, na ordem do cardápio', () => {
    expect(point.modifiers.map((m) => m.name)).toEqual(['Mal passado', 'Ao ponto'])
    expect(needsOptions(product)).toBe(true)
    expect(needsOptions(skewer({ modifierGroups: [] }))).toBe(false)
  })

  it('grupo obrigatório sem escolha impede adicionar, com a mensagem do grupo', () => {
    expect(selectionIssues(groups, {})).toEqual([
      { groupId: 'g-point', message: 'Escolha uma opção em Ponto da carne.' },
    ])
    const chosen = toggleModifier({}, point, 'm-medium')
    expect(selectionIssues(groups, chosen)).toEqual([])
  })

  it('máximo 1 troca a opção; máximo maior acumula até o limite e não passa dele', () => {
    let selection: Selection = toggleModifier({}, point, 'm-rare')
    selection = toggleModifier(selection, point, 'm-medium')
    expect(selection['g-point']).toEqual(['m-medium'])

    selection = toggleModifier(selection, sides, 'm-farofa')
    selection = toggleModifier(selection, sides, 'm-bread')
    const atLimit = toggleModifier(selection, sides, 'm-vin')
    expect(atLimit['g-sides']).toEqual(['m-farofa', 'm-bread'])
    // Tocar de novo desmarca.
    expect(toggleModifier(atLimit, sides, 'm-farofa')['g-sides']).toEqual(['m-bread'])
  })

  it('acusa escolhas demais se a seleção vier acima do máximo', () => {
    expect(selectionIssues(groups, { 'g-point': ['m-rare'], 'g-sides': ['a', 'b', 'c'] })).toEqual([
      { groupId: 'g-sides', message: 'Escolha no máximo 2 em Acompanhamentos.' },
    ])
  })
})

describe('montagem do pedido: preços e totais exibidos (RN-04.06, RN-04.14)', () => {
  const selection: Selection = { 'g-point': ['m-medium'], 'g-sides': ['m-bread'] }
  const modifiers = chosenModifiers(groups, selection)

  it('linha = (preço unitário + acréscimos) × quantidade', () => {
    const line = buildLine({ product, modifiers, quantity: 3, note: '' })
    expect(line.unitPriceCents).toBe(1200)
    expect(lineTotalCents(line)).toBe((1200 + 300) * 3)
  })

  it('CA-04.07: usa o preço da tabela do turno quando o produto está nela', () => {
    const shiftPrices = [{ productId: 'p1', priceCents: 1000 }]
    expect(effectivePriceCents(product, shiftPrices)).toBe(1000)
    expect(effectivePriceCents(product, [{ productId: 'outro', priceCents: 1 }])).toBe(1200)
    const line = buildLine({ product, shiftPrices, modifiers, quantity: 2, note: '' })
    // Acréscimos de modificadores não mudam com a tabela do turno.
    expect(lineTotalCents(line)).toBe((1000 + 300) * 2)
  })

  it('junta linhas iguais, separa as com escolhas ou observação diferentes e soma o carrinho', () => {
    const plain = buildLine({ product, modifiers, quantity: 1, note: '' })
    let lines = addLine([], plain)
    lines = addLine(lines, buildLine({ product, modifiers, quantity: 2, note: '  ' }))
    expect(lines).toHaveLength(1)
    expect(lines[0]!.quantity).toBe(3)
    lines = addLine(lines, buildLine({ product, modifiers, quantity: 1, note: 'bem tostado' }))
    expect(lines).toHaveLength(2)
    expect(cartTotalCents(lines)).toBe(1500 * 4)
    lines = setLineQuantity(lines, plain.key, 0)
    expect(lines).toHaveLength(1)
  })

  it('observação até 140 caracteres e quantidade de 1 a 99 (RN-04.16)', () => {
    const line = buildLine({ product, modifiers, quantity: 500, note: 'x'.repeat(200) })
    expect(line.note).toHaveLength(140)
    expect(line.quantity).toBe(99)
    expect(cartIssue([])).toBe('Adicione pelo menos um item.')
  })

  it('monta o corpo do POST /tabs/{id}/orders na ordem das linhas', () => {
    const a = buildLine({ product, modifiers, quantity: 2, note: 'sem sal' })
    const b = buildLine({
      product: skewer({ id: 'p2', modifierGroups: [] }),
      modifiers: [],
      quantity: 1,
      note: '',
    })
    expect(toOrderBody([a, b])).toEqual({
      items: [
        { productId: 'p1', quantity: 2, modifierIds: ['m-medium', 'm-bread'], note: 'sem sal' },
        { productId: 'p2', quantity: 1, modifierIds: [] },
      ],
    })
  })
})

describe('montagem do pedido: recusas (RN-04.17, CA-04.06)', () => {
  it('ORDER_REJECTED aponta a linha pelo índice do corpo enviado', () => {
    const a = buildLine({ product, modifiers: [], quantity: 1, note: '' })
    const b = buildLine({
      product: skewer({ id: 'p2', name: 'Kafta' }),
      modifiers: [],
      quantity: 1,
      note: '',
    })
    const result = rejectionsByLine(
      [a, b],
      [
        { index: 1, productId: 'p2', reason: 'sold_out', modifierGroupId: null },
        { index: 0, productId: 'p1', reason: 'modifier_required', modifierGroupId: 'g-point' },
        { index: 7, productId: 'p9', reason: 'sold_out', modifierGroupId: null },
      ],
    )
    expect(Object.keys(result)).toEqual([b.key, a.key])
    expect(result[b.key]![0]!.reason).toBe('sold_out')
  })

  it('produto esgotado ou fora do cardápio bloqueia o envio da linha', () => {
    const a = buildLine({ product, modifiers: [], quantity: 1, note: '' })
    const b = buildLine({ product: skewer({ id: 'p2' }), modifiers: [], quantity: 1, note: '' })
    const found = (id: string) => (id === 'p1' ? { active: true, soldOut: true } : null)
    expect(unavailableLines([a, b], found)).toEqual([a.key, b.key])
  })
})
