import { describe, expect, it } from 'vitest'
import { moveItem, sameOrder } from '../../app/lib/list'
import { validateWorkflow, workflowIssuesFrom, type StageDraft } from '../../app/lib/workflow'

const COUNTER = {
  id: '0192f000-0000-7000-8000-0000000000c1',
  kind: 'counter' as const,
  active: true,
}
const KITCHEN = { id: '0192f000-0000-7000-8000-0000000000a1', kind: 'queue' as const, active: true }
const DELIVERY = {
  id: '0192f000-0000-7000-8000-0000000000a2',
  kind: 'queue' as const,
  active: true,
}
const OLD = { id: '0192f000-0000-7000-8000-0000000000a3', kind: 'queue' as const, active: false }
const stations = [COUNTER, KITCHEN, DELIVERY, OLD]

type Stage = Pick<StageDraft, 'name' | 'target' | 'stationId'>
const stage = (name: string, target: Stage['target'], stationId: string | null = null): Stage => ({
  name,
  target,
  stationId,
})

/** Template padrão (spec 03, seção 4.4). */
const template: Stage[] = [
  stage('Recebido', 'product_station'),
  stage('Preparando', 'product_station'),
  stage('Pronto', 'fixed_station', DELIVERY.id),
  stage('Entregue', 'none'),
]

const codes = (stages: Stage[]) => validateWorkflow(stages, stations).map((issue) => issue.code)

describe('validação local do fluxo (RN-03.05, RN-03.06, CA-03.02)', () => {
  it('aceita o template padrão', () => {
    expect(validateWorkflow(template, stations)).toEqual([])
  })

  it('RN-03.05: de 2 a 8 etapas', () => {
    expect(codes([stage('Entregue', 'none')])).toContain('STAGE_COUNT')
    const nine = [
      ...Array.from({ length: 8 }, (_, i) => stage(`Etapa ${i}`, 'product_station')),
      stage('Fim', 'none'),
    ]
    expect(codes(nine)).toEqual(['STAGE_COUNT'])
    expect(codes([stage('A', 'product_station'), stage('Fim', 'none')])).toEqual([])
  })

  it('CA-03.02: recusa fluxo sem etapa final', () => {
    expect(codes(template.slice(0, 3))).toEqual(['NO_FINAL_STAGE'])
  })

  it('CA-03.02: recusa mais de uma etapa final e final fora do fim', () => {
    const issues = validateWorkflow(
      [stage('A', 'none'), stage('B', 'product_station'), stage('C', 'none')],
      stations,
    )
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'MULTIPLE_FINAL_STAGES', index: 0 }),
    )
    expect(
      codes([stage('A', 'product_station'), stage('Fim', 'none'), stage('C', 'product_station')]),
    ).toEqual(['FINAL_STAGE_NOT_LAST'])
  })

  it('CA-03.02 / RN-03.06: etapa não final não aponta para estação de balcão', () => {
    const issues = validateWorkflow(
      [stage('A', 'fixed_station', COUNTER.id), stage('Fim', 'none')],
      stations,
    )
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'STATION_NOT_QUEUE',
        index: 0,
        message: 'Etapas que não são finais precisam apontar para uma estação de fila.',
      }),
    ])
  })

  it('estação fixa é obrigatória, ativa e da unidade; só estação fixa escolhe estação', () => {
    expect(codes([stage('A', 'fixed_station'), stage('Fim', 'none')])).toEqual(['STATION_REQUIRED'])
    expect(codes([stage('A', 'fixed_station', OLD.id), stage('Fim', 'none')])).toEqual([
      'STATION_NOT_IN_UNIT',
    ])
    expect(codes([stage('A', 'product_station', KITCHEN.id), stage('Fim', 'none')])).toEqual([
      'STATION_NOT_ALLOWED',
    ])
  })

  it('nomes não se repetem, sem diferenciar maiúsculas', () => {
    expect(codes([stage('Pronto', 'product_station'), stage(' pronto ', 'none')])).toEqual([
      'DUPLICATE_NAME',
    ])
  })

  it('lê os problemas de INVALID_WORKFLOW da API e ignora o que não for problema', () => {
    const issue = { code: 'NO_FINAL_STAGE', index: null, message: 'Sem final.' }
    expect(workflowIssuesFrom({ issues: [issue, { foo: 1 }, null] })).toEqual([issue])
    expect(workflowIssuesFrom(undefined)).toEqual([])
    expect(workflowIssuesFrom({ issues: 'x' })).toEqual([])
  })
})

describe('ordenação de listas', () => {
  it('move um item e mantém os outros na ordem', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false)
  })
})
