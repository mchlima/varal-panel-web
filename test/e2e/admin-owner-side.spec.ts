import { expect, test } from '@playwright/test'
import {
  adminCall,
  apiBaseUrl,
  expectApiUp,
  loginAdmin,
  loginOwner,
  seed,
  seedOrganization,
  shareAdminSession,
  skipWithoutSessionCookies,
  type AdminSession,
} from './fixtures'

/**
 * Lado do dono do admin da plataforma (spec 02) contra a API real com o seed: "entrar como"
 * (RN-02.17 a RN-02.22, CA-02.07 a CA-02.09), comunicados (RN-02.16, CA-02.06) e a faixa de
 * suspensão (RN-02.12, CA-02.05). O admin entra pela API no mesmo navegador, como faria pelo
 * varal-admin-web, e gera o link `/entrar-como#token=...`.
 */
const suffix = Date.now().toString(36).slice(-5)

interface StartedImpersonation {
  handoffUrl: string
  impersonation: { id: string }
}

let admin: AdminSession
let organization: { id: string; subscriptionStatus: string }

test.beforeAll(async () => {
  await expectApiUp()
  admin = await loginAdmin()
  organization = await seedOrganization(admin)
})

test.afterAll(async () => {
  await admin?.request.dispose()
})

test.beforeEach(({ browserName }) => skipWithoutSessionCookies(browserName))

test('"entrar como" de ponta a ponta: faixa em todas as telas, auditoria e lista do dono (CA-02.07, CA-02.09)', async ({
  page,
}) => {
  const reason = `Ajuda com o cardápio ${suffix}`
  const started = await adminCall<StartedImpersonation>(admin, 'POST', '/impersonations', {
    organizationId: organization.id,
    reason,
  })
  expect(started.handoffUrl).toContain('/entrar-como#token=')

  // RN-02.21: o link troca o token pela sessão do app e abre o painel; o token sai da URL.
  // O navegador precisa ter a sessão do admin que gerou o link.
  await shareAdminSession(admin, page.context())
  await page.goto(started.handoffUrl)
  await expect(page).toHaveURL(/\/painel$/)
  expect(page.url()).not.toContain('token=')

  // RN-02.19: faixa fixa com organização, admin, tempo restante e "Encerrar acesso".
  const banner = page.getByTestId('impersonation-banner')
  await expect(banner).toContainText(
    `Você está acessando como ${seed.organizationName} — ${admin.name}`,
  )
  await expect(page.getByTestId('impersonation-remaining')).toHaveText(/Restam (60|59) min/)
  await expect(banner.getByRole('button', { name: 'Encerrar acesso' })).toBeVisible()

  // CA-02.07: a faixa fica visível em todas as telas.
  for (const path of [
    '/painel/unidades',
    '/painel/colaboradores',
    '/painel/acesso-da-equipe',
    '/estacoes',
    '/painel/acessos-de-suporte',
  ]) {
    await page.goto(path)
    await expect(banner, `faixa em ${path}`).toBeVisible()
  }
  // O acesso aparece em andamento na lista do dono (RN-02.22).
  await expect(
    page.getByTestId('support-access').filter({ hasText: reason }).first(),
  ).toContainText('Em andamento')

  // CA-02.07: alteração no cardápio feita no "entrar como" vai para a auditoria com o admin.
  const category = `Suporte ${suffix}`
  await page.goto('/painel/cardapio')
  await page.getByRole('button', { name: 'Nova categoria' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nome da categoria').fill(category)
  const created = page.waitForResponse(
    (r) => r.url().includes('/categories') && r.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Criar categoria' }).click()
  expect((await created).status()).toBe(201)
  await expect(page.getByRole('tab', { name: category })).toBeVisible()
  await expect(banner).toBeVisible()

  const audit = await adminCall<{
    data: {
      action: string
      impersonatorId: string | null
      impersonationId: string | null
      actorType: string
      changes: unknown
    }[]
  }>(
    admin,
    'GET',
    `/audit-logs?organizationId=${organization.id}&impersonatorId=${admin.id}&action=category.created`,
  )
  const entry = audit.data.find((e) => JSON.stringify(e.changes).includes(category))
  expect(entry, 'categoria criada no "entrar como" está na auditoria').toBeDefined()
  expect(entry!.impersonatorId).toBe(admin.id)
  expect(entry!.impersonationId).toBe(started.impersonation.id)

  // Link de uso único: abrir de novo mostra o erro, sem trocar a sessão.
  await page.goto(started.handoffUrl)
  await expect(page.getByTestId('impersonation-error')).toContainText('já foi usado ou venceu')

  // "Encerrar acesso": volta ao login com aviso e a sessão deixa de valer.
  await page.goto('/painel')
  await banner.getByRole('button', { name: 'Encerrar acesso' }).click()
  await expect(page).toHaveURL(/\/entrar$/)
  await expect(page.getByTestId('impersonation-ended')).toBeVisible()
  await expect(page.getByTestId('impersonation-banner')).toHaveCount(0)
  const me = await page.context().request.get(`${apiBaseUrl}/api/v1/auth/me`)
  expect(me.status()).toBe(401)

  // CA-02.09: o dono vê o acesso, com admin, motivo e horários.
  await loginOwner(page)
  await expect(page.getByTestId('impersonation-banner')).toHaveCount(0)
  await page.goto('/painel/acessos-de-suporte')
  const access = page.getByTestId('support-access').filter({ hasText: reason }).first()
  await expect(access).toContainText(admin.name)
  await expect(access).toContainText('Encerrado')
  await expect(access).toContainText('Início')
  await expect(access).toContainText(/Fim\s*\d{2}\/\d{2}\/\d{4}/)
})

test('link do "entrar como" aberto em outro navegador não funciona (RN-02.21)', async ({
  browser,
}) => {
  const started = await adminCall<StartedImpersonation>(admin, 'POST', '/impersonations', {
    organizationId: organization.id,
    reason: `Teste de link vazado ${suffix}`,
  })
  const other = await browser.newContext()
  try {
    const leaked = await other.newPage()
    await leaked.goto(started.handoffUrl)
    await expect(leaked.getByTestId('impersonation-error')).toContainText(
      'só funciona no navegador em que você está logado no admin',
    )
    await expect(leaked).toHaveURL(/\/entrar-como$/)
  } finally {
    await other.close()
    await adminCall(admin, 'POST', `/impersonations/${started.impersonation.id}/end`)
  }
})

test('admin encerra o acesso: o painel cai na hora e a sessão é recusada (RN-02.21, CA-02.08)', async ({
  page,
}) => {
  const started = await adminCall<StartedImpersonation>(admin, 'POST', '/impersonations', {
    organizationId: organization.id,
    reason: `Teste de encerramento ${suffix}`,
  })
  await shareAdminSession(admin, page.context())
  await page.goto(started.handoffUrl)
  await expect(page).toHaveURL(/\/painel$/)
  await expect(page.getByTestId('realtime-status')).toContainText('Conectado')

  await adminCall(admin, 'POST', `/impersonations/${started.impersonation.id}/end`)
  // `session.revoked` no tempo real leva ao login, com o aviso.
  await expect(page).toHaveURL(/\/entrar$/, { timeout: 5_000 })
  await expect(page.getByTestId('impersonation-ended')).toBeVisible()
  const me = await page.context().request.get(`${apiBaseUrl}/api/v1/auth/me`)
  expect(me.status()).toBe(401)
})

test('comunicado aparece na faixa do dono e some depois de lido (RN-02.16, CA-02.06)', async ({
  page,
}) => {
  const title = `Novidade ${suffix}`
  const announcement = await adminCall<{ id: string }>(admin, 'POST', '/announcements', {
    title,
    body: `Agora o **painel** tem comunicados.\n\n- leia\n- marque como lido\n\n<script>window.hacked = true</script>`,
    audienceType: 'selected',
    organizationIds: [organization.id],
  })
  await adminCall(admin, 'POST', `/announcements/${announcement.id}/publish`, {})
  try {
    await loginOwner(page)
    const banner = page.getByTestId('announcements-banner')
    await expect(banner).toContainText(title)
    await banner.getByRole('button', { name: new RegExp(title) }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: title })).toBeVisible()
    await expect(dialog.locator('strong', { hasText: 'painel' })).toBeVisible()
    await expect(dialog.locator('li')).toHaveCount(2)
    // Markdown seguro: o HTML aparece como texto, nada é executado.
    await expect(dialog).toContainText('<script>window.hacked = true</script>')
    expect(await page.evaluate(() => (window as { hacked?: boolean }).hacked)).toBeUndefined()

    await dialog.getByRole('button', { name: 'Marcar como lido' }).click()
    await expect(page.getByTestId('announcements-banner').filter({ hasText: title })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByTestId('announcements-banner').filter({ hasText: title })).toHaveCount(0)
  } finally {
    await adminCall(admin, 'POST', `/announcements/${announcement.id}/archive`)
  }
})

test('organização suspensa mostra a faixa com o motivo no painel do dono (RN-02.12, CA-02.05)', async ({
  page,
}) => {
  const original = organization.subscriptionStatus === 'active' ? 'active' : 'pilot'
  const reason = `Pagamento em atraso ${suffix}`
  await adminCall(admin, 'POST', `/organizations/${organization.id}/suspend`, { reason })
  try {
    await loginOwner(page)
    const banner = page.getByTestId('organization-status-banner')
    await expect(banner).toContainText('Conta suspensa')
    await expect(banner).toContainText(reason)
    await expect(banner).toContainText('Não é possível abrir turno')
    await page.goto('/painel/cardapio')
    await expect(banner).toBeVisible()
  } finally {
    await adminCall(admin, 'POST', `/organizations/${organization.id}/reactivate`, {
      reason: `Fim do teste ${suffix}`,
      status: original,
    })
  }
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByTestId('organization-status-banner')).toHaveCount(0)
})
