import { expect, test } from '@playwright/test'
import {
  apiBaseUrl,
  expectApiUp,
  loginOwner,
  loginStaffByLink,
  seed,
  skipWithoutSessionCookies,
} from './fixtures'

test.beforeAll(async () => {
  await expectApiUp()
})

test.describe('com sessão', () => {
  test.beforeEach(({ browserName }) => skipWithoutSessionCookies(browserName))

  test('dono entra com e-mail e senha, vê o painel e sai', async ({ page }) => {
    await page.goto('/entrar')
    await expect(page.getByRole('tab', { name: 'Sou dono' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await loginOwner(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Olá, Dono')
    await expect(page.getByText(seed.organizationName).first()).toBeVisible()
    await expect(page.getByTestId('realtime-status')).toContainText('Conectado')

    // Recarregar mantém a sessão (cookies da API + /auth/me).
    await page.reload()
    await expect(page).toHaveURL(/\/painel$/)

    // Logado, o login leva ao início.
    await page.goto('/entrar')
    await expect(page).toHaveURL(/\/painel$/)

    await page.getByRole('button', { name: 'Sair' }).click()
    await expect(page).toHaveURL(/\/entrar$/)
    await page.goto('/painel')
    await expect(page).toHaveURL(/\/entrar$/)
  })

  test('CA-01.03: colaborador entra pelo link /e/{codigo} digitando só usuário e senha', async ({
    page,
  }) => {
    await page.goto(`/e/${seed.accessCode}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(seed.organizationName)
    await expect(page.getByRole('tab', { name: 'Sou colaborador' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByText(`Código da barraca: ${seed.accessCode}`)).toBeVisible()

    // A ana opera caixa: entra no início do painel (RN-01.23, RN-01.24).
    await loginStaffByLink(page, seed.staffUsername, /\/painel$/)
    await expect(page.getByTestId('home-action')).toBeVisible()

    // Mas não abre os cadastros nem os relatórios do dono (RN-01.23, RN-07.07).
    await page.goto('/painel/cardapio')
    await expect(page).toHaveURL(/\/painel$/)
    await page.goto('/painel/relatorios')
    await expect(page).toHaveURL(/\/painel$/)
  })

  test('renova a sessão quando o token de acesso some (401 → refresh)', async ({
    page,
    context,
  }) => {
    await loginOwner(page)
    // Espera o painel terminar de carregar: uma requisição em voo sem o cookie renovaria antes
    // de o teste começar a ouvir a renovação.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Olá, Dono')
    await page.waitForLoadState('networkidle')
    await context.clearCookies({ name: '__Host-varal_at' })
    const refreshed = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/auth/refresh') && r.status() === 200,
    )
    await page.reload()
    await refreshed
    await expect(page).toHaveURL(/\/painel$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Olá, Dono')
  })

  test('session.revoked no tempo real leva de volta ao login', async ({ page }) => {
    await loginOwner(page)
    await expect(page.getByTestId('realtime-status')).toContainText('Conectado')
    // Logout por fora da tela (mesmos cookies): a API revoga e avisa o socket.
    const response = await page.request.post(`${apiBaseUrl}/api/v1/auth/logout`, {
      headers: { Origin: new URL(page.url()).origin },
    })
    expect(response.status()).toBe(204)
    await expect(page).toHaveURL(/\/entrar$/)
  })

  test('toque no Entrar logo depois de corrigir os campos não se perde', async ({ page }) => {
    await page.goto('/entrar')
    const submit = page.getByRole('button', { name: 'Entrar' })
    await submit.click()
    await expect(page.getByText('Informe a senha.')).toBeVisible()

    await page.getByLabel('E-mail').fill(seed.ownerEmail)
    await page.getByLabel('Senha', { exact: true }).fill(seed.password)
    // Com o foco ainda na senha, aperta e solta como uma pessoa, um instante depois e no
    // mesmo ponto da tela (sem Enter).
    const box = await submit.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height - 8)
    await page.mouse.down()
    await page.waitForTimeout(150)
    await page.mouse.up()

    await expect(page).toHaveURL(/\/painel$/)
  })

  test('sem conexão depois do login, o indicador fixo aparece no topo', async ({
    page,
    context,
  }) => {
    await loginStaffByLink(page)
    await context.setOffline(true)
    const banner = page.getByTestId('connection-banner')
    await expect(banner).toHaveText('Sem conexão')
    await expect(page.getByTestId('realtime-status')).toContainText('Sem conexão')
    await context.setOffline(false)
    await expect(banner).toBeHidden()
    await expect(page.getByTestId('realtime-status')).toContainText('Conectado')
  })
})

test('senha errada mostra a mensagem da API', async ({ page }) => {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(seed.ownerEmail)
  await page.getByLabel('Senha', { exact: true }).fill('senha-errada')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/entrar$/)
})

test('código de acesso inválido mostra mensagem clara', async ({ page }) => {
  await page.goto('/e/ZZZZZZ')
  await expect(page.getByText('Código de acesso inválido.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Digitar o código' })).toBeVisible()
})

test('sem conexão, o indicador fixo aparece no topo', async ({ page, context }) => {
  await page.goto('/entrar')
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
  await context.setOffline(true)
  const banner = page.getByTestId('connection-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Sem conexão')
  await context.setOffline(false)
  await expect(banner).toBeHidden()
})

test('esqueci a senha responde com a mensagem neutra (RN-01.03)', async ({ page, browserName }) => {
  // A API limita "esqueci a senha" a 5 pedidos por IP a cada 15 min: um pedido por execução.
  test.skip(browserName === 'webkit', 'Economiza o limite por IP; o Chromium cobre a tela')
  await page.goto('/esqueci-a-senha')
  await page.getByLabel('E-mail da conta').fill('ninguem@varal.local')
  await page.getByRole('button', { name: 'Enviar link' }).click()
  await expect(page.getByRole('status')).toContainText('Se houver uma conta com esse e-mail')
})

test('definir senha tira o token da barra de endereço e valida a senha', async ({ page }) => {
  await page.goto('/definir-senha#token=abcdefghijklmnopqrstuvwxyz0123456789&tipo=convite')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Crie sua senha')
  await expect(page).toHaveURL(/\/definir-senha$/)

  await page.getByLabel('Nova senha').fill('curta')
  await page.getByRole('button', { name: 'Salvar senha' }).click()
  await expect(page.getByText('A senha precisa ter pelo menos 8 caracteres.')).toBeVisible()

  await page.getByLabel('Nova senha').fill('uma senha boa')
  await page.getByLabel('Repita a senha').fill('outra senha')
  await page.getByRole('button', { name: 'Salvar senha' }).click()
  await expect(page.getByText('As duas senhas não são iguais.')).toBeVisible()

  // Token inventado: a API recusa e a tela oferece um novo link.
  await page.getByLabel('Repita a senha').fill('uma senha boa')
  await page.getByRole('button', { name: 'Salvar senha' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pedir um novo link' })).toBeVisible()
})

test('iPhone mostra como instalar pelo Compartilhar', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'Instrução própria do iOS')
  await page.goto('/entrar')
  const hint = page.getByTestId('install-hint')
  await expect(hint).toContainText('Compartilhar')
  await expect(hint).toContainText('Adicionar à Tela de Início')
  await hint.getByRole('button', { name: 'Agora não' }).click()
  await expect(hint).toBeHidden()
})

test('a mensagem de erro aparecer e o campo ser corrigido não movem o botão Entrar', async ({
  page,
}) => {
  await page.goto('/entrar')
  const submit = page.getByRole('button', { name: 'Entrar' })
  const initial = await submit.boundingBox()
  await submit.click()
  await expect(page.getByText('Informe o e-mail.')).toBeVisible()
  expect(await submit.boundingBox()).toEqual(initial)

  await page.getByLabel('E-mail').fill(seed.ownerEmail)
  await page.getByLabel('E-mail').blur()
  expect(await submit.boundingBox()).toEqual(initial)
})
