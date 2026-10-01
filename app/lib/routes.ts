/** Rotas abertas, sem sessão (spec 01, seção 14.1). */
export function isPublicRoute(path: string): boolean {
  return (
    path === '/entrar' ||
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
