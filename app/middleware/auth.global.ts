import { isLoginRoute, isPublicRoute } from '~/lib/routes'

/**
 * Acesso às páginas (spec 01, seção 14.1): sem sessão, as páginas protegidas levam ao
 * `/entrar`; com sessão, o login leva ao início (painel do dono ou estações).
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const session = useSessionStore()
  if (session.status === 'unknown') await session.restore()

  if (to.path === '/') {
    return navigateTo(session.isAuthenticated ? session.homePath : '/entrar', { replace: true })
  }

  if (!session.isAuthenticated) {
    return isPublicRoute(to.path) ? undefined : navigateTo('/entrar', { replace: true })
  }

  if (isLoginRoute(to.path)) return navigateTo(session.homePath, { replace: true })

  // O painel é só do dono; o turno também é de quem opera caixa (RN-04.02).
  const canOperateCash = session.me?.units.some((unit) => unit.canOperateCash) === true
  if (to.path === '/painel/turnos' && canOperateCash) return
  // Fiado: o dono e quem tem balcão veem (spec 06); editar e remover cliente é só do dono.
  const hasCounter =
    session.me?.units.some((unit) =>
      unit.stations.some((station) => station.kind === 'counter'),
    ) === true
  if (to.path.startsWith('/painel/fiado') && hasCounter) return
  // Caixas: dono e quem opera caixa (RN-05.16).
  if (to.path.startsWith('/caixas') && !session.isOwner && !canOperateCash) {
    return navigateTo('/estacoes', { replace: true })
  }
  if (to.path.startsWith('/painel') && !session.isOwner) {
    return navigateTo('/estacoes', { replace: true })
  }
})
