# varal-panel-web

App dos clientes do Varal (Nuxt, PWA): balcão, estações, caixa e painel do dono.

Specs e decisões do produto: [varal-docs](https://github.com/mchlima/varal-docs). Regras para agentes: [`AGENTS.md`](AGENTS.md).

## Stack

Nuxt 4 em modo SPA (`ssr: false`, build estático com `nuxt generate`), TypeScript estrito, Tailwind CSS 4 com os tokens da spec 08, Reka UI, fontes servidas pelo app (`@fontsource`), cliente da API gerado do OpenAPI (openapi-typescript + openapi-fetch). Testes com Vitest e `@nuxt/test-utils`.

## Requisitos

- Node 22.19 ou mais novo
- pnpm 10 (`corepack enable`)
- Hooks de bloqueio da `main` ativos no clone: `git config core.hooksPath .githooks`

## Comandos

| Comando           | O que faz                                                                        |
| ----------------- | -------------------------------------------------------------------------------- |
| `pnpm install`    | Instala as dependências (e roda `nuxt prepare`)                                  |
| `pnpm dev`        | Servidor de desenvolvimento na porta `3100 + PORT_OFFSET` (lida do `.env.local`) |
| `pnpm generate`   | Build estático em `.output/public`                                               |
| `pnpm preview`    | Serve o build localmente                                                         |
| `pnpm lint`       | ESLint e Prettier (só verifica)                                                  |
| `pnpm format`     | Corrige o que o ESLint e o Prettier conseguem                                    |
| `pnpm typecheck`  | Checagem de tipos (`nuxt typecheck`)                                             |
| `pnpm test`       | Testes (Vitest)                                                                  |
| `pnpm test:watch` | Testes em modo observação                                                        |
| `pnpm gen:api`    | Gera `app/api/schema.d.ts` a partir do `openapi.json` do `varal-web-api`         |

## Ambiente

Variáveis documentadas em [`.env.example`](.env.example). A URL da API (`NUXT_PUBLIC_API_BASE_URL`) é fixada no build: cada ambiente tem o próprio build. Padrão: `http://localhost:3000`, a API do checkout principal.

## Worktrees

Cada tarefa roda num worktree próprio em `.worktrees/` (spec 01, seção 4.1):

```bash
scripts/worktree.sh new feat/minha-tarefa   # cria o worktree, o .env.local (PORT_OFFSET livre) e instala
scripts/worktree.sh list                    # worktrees com branch, offset e porta
scripts/worktree.sh remove feat-minha-tarefa
```

## Cliente da API

Os tipos da API vêm do `openapi.json` commitado no `varal-web-api` (RN-01.11):

```bash
pnpm gen:api                                   # lê ../varal-web-api/openapi.json
OPENAPI_SOURCE=<caminho-ou-url> pnpm gen:api   # outra origem (ex.: na CI)
```

O arquivo `app/api/schema.d.ts` é commitado e nunca editado à mão. No app, use o cliente do plugin:

```ts
const { $api } = useNuxtApp()
const { data, error } = await $api.GET('/api/v1/...')
```

## Identidade visual

Tokens de cor, status, tipografia e cantos da spec 08 ficam em `app/assets/css/tokens.css`, no `@theme` do Tailwind (a paleta padrão do Tailwind é removida). Logo e ícones em `public/` são cópias de `varal-docs/docs/brand/` (RN-08.01): mudanças são feitas lá e copiadas para cá.

## Versões e CI

- CI (`.github/workflows/ci.yml`): lint, tipos, testes e build em todo PR e na `main`.
- Título do PR checado no padrão Conventional Commits.
- release-please mantém o PR de release com versão e changelog.
