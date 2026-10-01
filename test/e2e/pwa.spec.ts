import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/**
 * PWA (plano 2.3) sobre o build estático (`pnpm generate`): o service worker faz o
 * precache do app e, sem rede, qualquer rota abre o app a partir do cache.
 * Sem `.output/public/sw.js`, o teste é pulado (rode `pnpm generate` antes).
 */
const root = resolve('.output/public')
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

let server: http.Server
let origin = ''

test.beforeAll(async () => {
  test.skip(!existsSync(join(root, 'sw.js')), 'Sem build estático: rode pnpm generate antes.')
  server = http.createServer(async (req, res) => {
    let path = join(root, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname))
    try {
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html')
    } catch {
      path = join(root, '200.html')
    }
    try {
      const body = await readFile(path)
      res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://localhost:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise((done) => server?.close(done))
})

async function waitForServiceWorker(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration()
          return registration?.active?.state ?? 'none'
        }),
      { timeout: 30_000 },
    )
    .toBe('activated')
}

test('manifesto do app instalável', async ({ request }) => {
  const response = await request.get(`${origin}/manifest.webmanifest`)
  const manifest = await response.json()
  expect(manifest).toMatchObject({
    name: 'Varal',
    lang: 'pt-BR',
    theme_color: '#BE185D',
    display: 'standalone',
  })
  expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toContain('maskable')
})

test('sem rede, o app abre do cache e mostra o indicador', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Service worker em http://localhost: só no Chromium')
  await page.goto(`${origin}/entrar`)
  await waitForServiceWorker(page)
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)

  await context.setOffline(true)
  await page.goto(`${origin}/e/ESPT26`)
  await expect(page.getByTestId('connection-banner')).toHaveText('Sem conexão')

  await page.goto(`${origin}/definir-senha#token=abcdefghijklmnopqrstuvwxyz&tipo=convite`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Crie sua senha')
})
