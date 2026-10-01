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

/** Início depois do login: o dono vê o painel; o colaborador escolhe a estação (spec 01, 7.1). */
export function homePathFor(type: SubjectType): string {
  return type === 'owner' ? '/painel' : '/estacoes'
}
