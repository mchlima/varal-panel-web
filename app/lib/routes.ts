/**
 * Rotas abertas, sem sessão (spec 01, seção 14.1). `/entrar-como` troca o link do
 * "entrar como" por uma sessão (spec 02, RN-02.21) e abre com ou sem sessão do painel.
 */
export function isPublicRoute(path: string): boolean {
  return (
    path === '/entrar' ||
    path === '/entrar-como' ||
    path === '/esqueci-a-senha' ||
    path === '/definir-senha' ||
    path.startsWith('/e/')
  )
}

/** Rotas de login: quem já está logado vai direto para o início. */
export function isLoginRoute(path: string): boolean {
  return path === '/entrar' || path.startsWith('/e/')
}

export type SubjectType = 'owner' | 'staff'

/** O que as regras de navegação precisam do `/auth/me`. */
export interface AccessProfile {
  subject: { type: SubjectType }
  units: {
    id: string
    canOperateCash: boolean
    stations: { id: string; kind: 'counter' | 'queue' }[]
  }[]
}

/**
 * RN-01.23: têm painel o dono e o colaborador que opera caixa em alguma unidade (início, caixas,
 * fiado e eventos). O colaborador só com estações não tem painel: a casa dele é a estação.
 */
export function hasPanelAccess(me: AccessProfile | null | undefined): boolean {
  if (!me) return false
  return me.subject.type === 'owner' || me.units.some((unit) => unit.canOperateCash)
}

/** Dono ou quem opera caixa na unidade (RN-05.16, RN-04.31). */
export function canOperateCashIn(me: AccessProfile | null | undefined, unitId: string): boolean {
  if (!me) return false
  return (
    me.subject.type === 'owner' ||
    me.units.some((unit) => unit.id === unitId && unit.canOperateCash)
  )
}

/** Todas as estações que o usuário pode abrir, de todas as unidades. */
export function allStations(me: AccessProfile | null | undefined) {
  return (me?.units ?? []).flatMap((unit) =>
    unit.stations.map((station) => ({ unitId: unit.id, ...station })),
  )
}

/** Rota da estação: balcão vai ao varal; fila, à tela da estação (spec 01, seção 14.1). */
export function stationPath(station: { id: string; kind: 'counter' | 'queue' }): string {
  return station.kind === 'counter' ? '/balcao' : `/estacao/${station.id}`
}

/**
 * Início depois do login (spec 01, seção 7.1 e RN-01.26): quem tem painel vai ao início do
 * painel; o colaborador com uma única estação liberada entra direto nela; com mais de uma,
 * escolhe em `/estacoes`.
 */
export function homePathFor(me: AccessProfile | null | undefined): string {
  if (!me) return '/entrar'
  if (hasPanelAccess(me)) return '/painel'
  const stations = allStations(me)
  return stations.length === 1 ? stationPath(stations[0]!) : '/estacoes'
}
