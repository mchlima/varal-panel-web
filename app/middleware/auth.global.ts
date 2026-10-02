import { isLoginRoute, isPublicRoute } from '~/lib/routes'

/**
 * Acesso às páginas (spec 01, seções 14.1 e 14.2): sem sessão, as páginas protegidas levam ao
 * `/entrar`; com sessão, o login leva ao início (painel, estação única ou escolha de estação).
 * A API continua sendo a barreira: aqui só se evita abrir uma tela que vai responder 403.
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

  // Rotas do turno, que saiu em 2026-10-02 (spec 01, seção 14.1).
  if (to.path === '/painel/turnos' || to.path === '/painel/turnos/') {
    return navigateTo('/painel', { replace: true })
  }
  // O relatório do turno virou relatório do dia (spec 07); sem o dia do turno, vai ao histórico.
  if (to.path.startsWith('/painel/relatorios/turnos/')) {
    return navigateTo('/painel/relatorios', { replace: true })
  }

  if (session.isOwner) return
  const home = session.homePath
  const away = () => (to.path === home ? undefined : navigateTo(home, { replace: true }))

  // Caixas: dono e quem opera caixa (RN-05.16).
  if (to.path.startsWith('/caixas')) return session.hasPanel ? undefined : away()
  // Fiado: quem tem painel e quem tem balcão (spec 06); editar e remover cliente é só do dono.
  const hasCounter =
    session.me?.units.some((unit) =>
      unit.stations.some((station) => station.kind === 'counter'),
    ) === true
  if (to.path.startsWith('/painel/fiado')) {
    return session.hasPanel || hasCounter ? undefined : away()
  }
  // Início e eventos (iniciar e encerrar) também para quem opera caixa (RN-01.23, RN-04.34).
  if (to.path === '/painel' || to.path === '/painel/') return session.hasPanel ? undefined : away()
  if (to.path === '/painel/eventos' || /^\/painel\/eventos\/(?!novo)[^/]+$/.test(to.path)) {
    return session.hasPanel ? undefined : away()
  }
  // Cadastros, relatórios e o resto do painel: só o dono (RN-07.07).
  if (to.path.startsWith('/painel'))
    return navigateTo(session.hasPanel ? '/painel' : home, {
      replace: true,
    })
})
