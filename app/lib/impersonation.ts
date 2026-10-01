/**
 * "Entrar como" no painel (spec 02, seção 7): textos da faixa (RN-02.19) e dos erros da
 * troca do link (RN-02.21).
 */

export const IMPERSONATION_LINK_MISSING =
  'Link incompleto. Volte ao admin do Varal e use "Entrar como" de novo.'

/**
 * Mensagem para a falha de `POST /auth/impersonation`:
 * - 401: este navegador não tem a sessão do admin que gerou o link (link aberto em outro
 *   navegador ou admin deslogado);
 * - 400 `INVALID_IMPERSONATION_TOKEN`: link já usado, vencido (2 minutos) ou de outro admin.
 */
export function impersonationErrorMessage(
  status: number,
  code: string | undefined,
  apiMessage: string,
): string {
  if (status === 401) {
    return 'Este link só funciona no navegador em que você está logado no admin do Varal. Abra o link pelo admin, neste mesmo navegador.'
  }
  if (code === 'INVALID_IMPERSONATION_TOKEN') {
    return 'Este link já foi usado ou venceu. Ele vale uma única vez, por 2 minutos. Gere um novo acesso pelo admin do Varal.'
  }
  return apiMessage
}
