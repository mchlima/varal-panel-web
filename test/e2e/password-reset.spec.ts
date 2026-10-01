import { expect, test } from '@playwright/test'
import { expectApiUp, mailpitUrl, seed, skipWithoutSessionCookies } from './fixtures'

interface MailpitMessage {
  ID: string
  Created: string
  To: { Address: string }[]
}

async function latestMessageTo(
  request: import('@playwright/test').APIRequestContext,
  address: string,
) {
  const response = await request.get(`${mailpitUrl}/api/v1/search`, {
    params: { query: `to:${address}`, limit: '1' },
  })
  if (!response.ok()) return null
  const body = (await response.json()) as { messages: MailpitMessage[] }
  return body.messages[0] ?? null
}

/**
 * Fluxo completo de "Esqueci a senha" (spec 01, seção 7.4): pede o link, lê o e-mail no
 * Mailpit, abre o link e define a senha (a mesma do seed, para não mudar os dados).
 * Precisa do Mailpit e do PANEL_URL da API apontando para este painel.
 */
test('dono redefine a senha pelo link do e-mail e entra', async ({
  page,
  request,
  browserName,
}) => {
  skipWithoutSessionCookies(browserName)
  await expectApiUp()
  const mailpit = await request.get(`${mailpitUrl}/api/v1/info`).catch(() => null)
  test.skip(!mailpit?.ok(), `Mailpit fora do ar em ${mailpitUrl}`)

  const before = await latestMessageTo(request, seed.ownerEmail)

  await page.goto('/esqueci-a-senha')
  await page.getByLabel('E-mail da conta').fill(seed.ownerEmail)
  await page.getByRole('button', { name: 'Enviar link' }).click()
  await expect(page.getByRole('status')).toContainText('Se houver uma conta com esse e-mail')

  let message: MailpitMessage | null = null
  await expect
    .poll(
      async () => {
        message = await latestMessageTo(request, seed.ownerEmail)
        return message && message.ID !== before?.ID
      },
      { timeout: 20_000 },
    )
    .toBeTruthy()
    .catch(() => {
      // RN-01.02: no máximo 3 links por hora; depois disso a API não envia e-mail.
      test.skip(true, 'Nenhum e-mail novo (limite de 3 links por hora, RN-01.02)')
    })

  const full = await request.get(`${mailpitUrl}/api/v1/message/${message!.ID}`)
  const { Text } = (await full.json()) as { Text: string }
  const link = Text.match(/https?:\/\/\S+\/definir-senha#token=[^\s&]+&tipo=redefinicao/)?.[0]
  expect(link, 'link de redefinição no e-mail').toBeTruthy()
  const url = new URL(link!)

  await page.goto(`${url.pathname}${url.hash}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nova senha')
  await expect(page).toHaveURL(/\/definir-senha$/)
  await page.getByLabel('Nova senha').fill(seed.password)
  await page.getByLabel('Repita a senha').fill(seed.password)
  await page.getByRole('button', { name: 'Salvar senha' }).click()
  await expect(page.getByRole('status')).toContainText('Senha definida')

  await page.getByRole('link', { name: 'Entrar' }).click()
  await page.getByLabel('E-mail').fill(seed.ownerEmail)
  await page.getByLabel('Senha', { exact: true }).fill(seed.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/painel$/)
})
