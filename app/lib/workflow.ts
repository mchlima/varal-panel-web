import type { components } from '../api/schema'

type Schemas = components['schemas']
export type WorkflowStageTarget = Schemas['WorkflowStageTarget']
export type WorkflowIssue = Schemas['WorkflowIssue']
export type WorkflowIssueCode = Schemas['WorkflowIssueCode']
export type Station = Schemas['Station']

/** RN-03.05: o fluxo tem de 2 a 8 etapas. */
export const MIN_STAGES = 2
export const MAX_STAGES = 8

/** Etapa em edição na tela (o `key` só identifica a linha; `id` é o da API, se já existe). */
export interface StageDraft {
  key: string
  id?: string
  name: string
  target: WorkflowStageTarget
  stationId: string | null
}

export const TARGET_LABELS: Record<WorkflowStageTarget, string> = {
  product_station: 'Estação de preparo do produto',
  fixed_station: 'Uma estação fixa',
  none: 'Etapa final (sai das filas)',
}

/**
 * Validação local do fluxo, igual à da API (`validateWorkflow`, spec 03, seção 4.2;
 * CA-03.02), para mostrar os problemas antes de salvar. Mesmos códigos e mensagens que
 * voltam em `INVALID_WORKFLOW` (`details.issues`):
 *
 * - RN-03.05: de 2 a 8 etapas; a última é a única com destino `none` (etapa final).
 * - RN-03.06: toda etapa não final aponta para uma estação de fila: `fixed_station` escolhe
 *   uma estação `queue` ativa da unidade; `product_station` usa a estação de preparo, que já
 *   é de fila (RN-03.08).
 * - Só `fixed_station` escolhe estação; nomes não se repetem (sem diferenciar maiúsculas).
 */
export function validateWorkflow(
  stages: readonly Pick<StageDraft, 'name' | 'target' | 'stationId'>[],
  stations: readonly Pick<Station, 'id' | 'kind' | 'active'>[],
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = []
  if (stages.length < MIN_STAGES || stages.length > MAX_STAGES) {
    issues.push({
      code: 'STAGE_COUNT',
      index: null,
      message: `O fluxo precisa ter de ${MIN_STAGES} a ${MAX_STAGES} etapas.`,
    })
  }

  const finals = stages.flatMap((stage, index) => (stage.target === 'none' ? [index] : []))
  if (finals.length === 0) {
    issues.push({
      code: 'NO_FINAL_STAGE',
      index: null,
      message: 'O fluxo precisa terminar numa etapa final (destino "nenhuma estação").',
    })
  } else if (finals.length > 1) {
    for (const index of finals.slice(0, -1)) {
      issues.push({
        code: 'MULTIPLE_FINAL_STAGES',
        index,
        message: 'Só a última etapa pode ser final.',
      })
    }
  }
  const lastFinal = finals.at(-1)
  if (lastFinal !== undefined && lastFinal !== stages.length - 1) {
    issues.push({
      code: 'FINAL_STAGE_NOT_LAST',
      index: lastFinal,
      message: 'A etapa final precisa ser a última do fluxo.',
    })
  }

  const byId = new Map(stations.map((station) => [station.id.toLowerCase(), station]))
  const names = new Set<string>()
  stages.forEach((stage, index) => {
    const stationId = stage.stationId ?? null
    if (stage.target === 'fixed_station') {
      if (stationId === null) {
        issues.push({
          code: 'STATION_REQUIRED',
          index,
          message: 'Escolha a estação em que o item aparece nesta etapa.',
        })
      } else {
        const station = byId.get(stationId.toLowerCase())
        if (!station?.active) {
          issues.push({
            code: 'STATION_NOT_IN_UNIT',
            index,
            message: 'A estação escolhida não existe nesta unidade ou está desativada.',
          })
        } else if (station.kind !== 'queue') {
          issues.push({
            code: 'STATION_NOT_QUEUE',
            index,
            message: 'Etapas que não são finais precisam apontar para uma estação de fila.',
          })
        }
      }
    } else if (stationId !== null) {
      issues.push({
        code: 'STATION_NOT_ALLOWED',
        index,
        message: 'Só etapas com estação fixa escolhem uma estação.',
      })
    }

    const key = stage.name.trim().toLocaleLowerCase('pt-BR')
    if (key && names.has(key)) {
      issues.push({
        code: 'DUPLICATE_NAME',
        index,
        message: 'Já existe outra etapa com este nome.',
      })
    }
    names.add(key)
  })
  return issues
}

/** Lê os problemas de um erro `INVALID_WORKFLOW` da API (`details.issues`). */
export function workflowIssuesFrom(details: unknown): WorkflowIssue[] {
  if (typeof details !== 'object' || details === null) return []
  const issues = (details as { issues?: unknown }).issues
  if (!Array.isArray(issues)) return []
  return issues.filter(
    (issue): issue is WorkflowIssue =>
      typeof issue === 'object' &&
      issue !== null &&
      typeof (issue as WorkflowIssue).message === 'string' &&
      typeof (issue as WorkflowIssue).code === 'string',
  )
}
