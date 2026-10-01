# varal-panel-web

App dos clientes do Varal (Nuxt, PWA): balcão, estações, caixa e painel do dono.

Specs e decisões do produto: [varal-docs](https://github.com/mchlima/varal-docs). Regras para agentes: [`AGENTS.md`](AGENTS.md).

## Stack

Nuxt 4 em modo SPA (`ssr: false`, build estático com `nuxt generate`), TypeScript estrito, Tailwind CSS 4 com os tokens da spec 08, Reka UI, fontes servidas pelo app (`@fontsource`), cliente da API gerado do OpenAPI (openapi-typescript + openapi-fetch), Pinia, PWA com `@vite-pwa/nuxt`, fila offline com Dexie (IndexedDB) e tempo real com `socket.io-client`. Testes com Vitest e `@nuxt/test-utils`; ponta a ponta com Playwright.

## Requisitos

- Node 26 (`.nvmrc`; com nvm: `nvm use`)
- pnpm 10 (`npm install -g pnpm@10`; o Node 26 não traz mais o corepack)
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
| `pnpm test:e2e`   | Playwright (Android e iPhone emulados) contra a API local; fora da CI            |

## Ambiente

Variáveis documentadas em [`.env.example`](.env.example). A URL da API (`NUXT_PUBLIC_API_BASE_URL`) é fixada no build: cada ambiente tem o próprio build. Padrão: `http://localhost:3000`, a API do checkout principal.

## Worktrees

Cada tarefa roda num worktree próprio fora do repositório, em `../.worktrees/varal-panel-web/<nome>` (spec 01, seção 4.1):

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

## Telas (spec 01, seções 14 e 14.1)

| Rota               | Tela                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/entrar`          | Login com abas "Sou dono" (e-mail e senha) e "Sou colaborador" (código, usuário e senha). `?aba=colaborador` abre na segunda aba                                                                                                          |
| `/e/{codigo}`      | Login do colaborador com o código preenchido e o nome da barraca no topo (`GET /auth/access-code/{code}`); código inválido mostra aviso (CA-01.03)                                                                                        |
| `/esqueci-a-senha` | Pedido de redefinição do dono; mensagem sempre igual (RN-01.03)                                                                                                                                                                           |
| `/definir-senha`   | Convite e redefinição: lê `token` e `tipo` do fragmento (`#token=...&tipo=convite\|redefinicao`), apaga o fragmento da barra de endereço, exige 8+ caracteres e confirmação                                                               |
| `/estacoes`        | Escolha de unidade (se houver mais de uma) e de estação entre as liberadas no `/auth/me`. A tabela de estações chega com a spec 03: até lá, as estações aparecem numeradas e, sem nenhuma, a tela diz "Nenhuma estação configurada ainda" |
| `/painel`          | Início mínimo do painel do dono (cabeçalho com organização, pessoa, conexão e "Sair")                                                                                                                                                     |

O middleware `app/middleware/auth.global.ts` leva páginas protegidas sem sessão para `/entrar`, quem já está logado do login para o início (`/painel` do dono, `/estacoes` do colaborador) e o colaborador para fora de `/painel`.

Componentes próprios em `app/components` (`AppButton`, `AppTextField`, `AppAlert`, `AppIcon`…), com Reka UI só nas abas. Uma única ação principal (botão preenchido) por tela, alvos de 48 px ou mais, foco visível e cores só dos tokens (spec 08).

## Sessão

- **Aparelho:** `app/lib/device-id.ts` gera um UUID v7 na primeira abertura e guarda no `localStorage` e no IndexedDB (cada leitura e escrita em `try/catch`; se um for limpo, o outro restaura; sem nenhum, vale só na aba). Vai como `X-Device-Id` em toda requisição e em `auth.deviceId` no socket.
- **Cliente HTTP:** plugin `app/plugins/02.api.ts` (`$api`), openapi-fetch com `credentials: 'include'`. O middleware de `app/lib/session.ts` põe o `X-Device-Id` e, num 401, chama `POST /auth/refresh` uma única vez para todas as requisições simultâneas (a renovação usa `fetch` direto, sem passar pelo middleware) e repete a requisição original uma vez. Renovação recusada limpa a sessão e volta ao login; falha de rede não desloga. Login, logout, "esqueci a senha", "definir senha" e consulta de código nunca disparam renovação.
- **Estado:** store Pinia `useSessionStore` com o `/auth/me` (perfil, organização, unidades e estações). O último perfil fica no `localStorage` para o app abrir sem rede; ele é atualizado quando o socket reconecta. "Sair" chama `POST /auth/logout` e limpa o estado (fica desabilitado enquanto houver ações na fila).
- **Erros:** a API responde `{ error: { code, message } }`; as telas mostram a `message` (pt-BR). Sem rede, uma mensagem própria (`app/lib/api-error.ts`).

## Tempo real

`app/lib/realtime.ts` e o plugin `04.realtime.client.ts` conectam enquanto houver sessão, conforme o README da API: `io(API, { path: '/ws', transports: ['websocket'], withCredentials: true, auth: { deviceId } })`.

- `session.revoked` → volta ao login (CA-01.05).
- `session.expired` ou `disconnect` com `io server disconnect` → `POST /auth/refresh` e `socket.connect()`; renovação recusada → login. `connect_error` com `UNAUTHENTICATED` faz o mesmo (até 3 vezes seguidas).
- A cada conexão e reconexão: reinicia a espera da fila, dispara o envio e chama os ganchos de "recarregar estado" (RN-01.05). As telas que aplicam eventos registram o seu com `useRealtimeResync(() => recarregarPorRest())`.
- O cabeçalho mostra "Conectado", "Conectando…" ou "Sem conexão", sempre com ícone e texto.

## Fila offline (spec 01, seção 11)

`app/lib/offline-queue.ts` (Dexie, banco `varal`, tabela `queue`). Ainda não há ações operacionais; a infraestrutura está pronta para as specs 04 e 05:

```ts
const queue = useOfflineQueue()
await queue.enqueue({
  method: 'POST',
  path: '/api/v1/...',
  body: { ... },
  label: 'Avançar 2 Espeto de carne', // aparece na tela se a API recusar
})
```

- A `Idempotency-Key` (UUID v7) é gerada no `enqueue` e reusada em toda tentativa.
- Um único processador envia em ordem; `navigator.locks` (`ifAvailable`) impede duas abas de processar juntas.
- Rede fora, 5xx, 408, 429 e `IDEMPOTENCY_REQUEST_IN_PROGRESS`: nova tentativa com espera exponencial (1 s a 60 s) e jitter, sem pular a fila. Outros 4xx: falha definitiva, mostrada no topo com a `message` da API e o botão "Dispensar".
- Gatilhos: evento `online` (zera a espera), app voltando ao primeiro plano (`visibilitychange`), a cada 30 s e na (re)conexão do socket.
- Faixa fixa no topo (`ConnectionBanner`): "Sem conexão — N ações aguardando envio", "Sem conexão" ou "Enviando N ações…".

## PWA

`@vite-pwa/nuxt`, configurado no `nuxt.config.ts`:

- Manifesto "Varal", `lang: pt-BR`, `theme_color: #BE185D`, `display: standalone`, ícones de `public/` (192, 512 e maskable 512).
- Precache do app inteiro (JS, CSS, HTML, ícones e fontes). Navegações sem rede abrem o `index.html` do cache (`navigateFallback`). Nenhuma rota da API é guardada (a API fica em outro host e não há `runtimeCaching`).
- `registerType: 'prompt'`: a faixa "Nova versão disponível" só aplica a atualização quando o usuário toca em "Atualizar" e a fila está vazia.
- Instalação: no Android, botão "Instalar" (`beforeinstallprompt`); no iPhone, instrução "Compartilhar → Adicionar à Tela de Início" (`InstallHint`). Depois do login o app pede `navigator.storage.persist()`.
- O service worker só existe no build (`pnpm generate`); no `pnpm dev` ele fica desligado. Para testar, sirva o `.output/public` (ex.: `npx serve .output/public`).

## Testes

- `pnpm test` (Vitest, entra na CI): sessão e renovação única, fila com `fake-indexeddb` (CA-01.07: ação feita sem conexão é enviada uma única vez quando a conexão volta), `deviceId`, cliente de tempo real com socket falso, telas de acesso, indicador de conexão e aviso de versão nova.
- `pnpm test:e2e` (Playwright, **fora da CI** porque precisa da API rodando): projetos `android` (Pixel 7, Chromium) e `iphone` (iPhone 15, WebKit).

### Testes de ponta a ponta

1. Suba a API de um worktree do `varal-web-api` (`scripts/worktree.sh new ...` cria banco e seed; depois `pnpm dev`), com a porta deste painel em `CORS_ORIGINS` e `PANEL_URL=http://localhost:<porta do painel>` no `.env.local` dela.
2. Aqui, `NUXT_PUBLIC_API_BASE_URL=http://localhost:<porta da API>` no `.env.local`.
3. `pnpm exec playwright install chromium webkit` (uma vez) e `pnpm test:e2e`. O Playwright sobe o `pnpm dev` se o painel não estiver rodando. Para o teste do service worker, rode `pnpm generate` antes (sem build ele é pulado).

Cobertura: login do dono, login do colaborador por `/e/{codigo}` (CA-01.03), código inválido, renovação ao perder o token de acesso, `session.revoked` levando ao login, indicador "Sem conexão" (`context.setOffline`), "esqueci a senha" lendo o e-mail no Mailpit (`MAILPIT_URL`, padrão `http://localhost:8025`) e definindo a senha pelo link, validações de `/definir-senha`, instrução de instalação no iPhone e app abrindo do cache sem rede.

**Limitação do WebKit:** os cookies da sessão são `Secure` (`__Host-`/`__Secure-`). O Chromium aceita esses cookies em `http://localhost`; o WebKit do Playwright no Linux não os guarda em http. Por isso os testes que dependem da sessão rodam só no projeto `android`; no `iphone` rodam as telas abertas. Em produção (https) o Safari funciona normalmente. A API limita "esqueci a senha" a 5 pedidos por IP a cada 15 minutos e 3 links por usuário por hora (RN-01.02): rodar a suíte muitas vezes seguidas pode pular o teste do Mailpit.

## Identidade visual

Tokens de cor, status, tipografia e cantos da spec 08 ficam em `app/assets/css/tokens.css`, no `@theme` do Tailwind (a paleta padrão do Tailwind é removida). Logo e ícones em `public/` são cópias de `varal-docs/docs/brand/` (RN-08.01): mudanças são feitas lá e copiadas para cá.

## Versões e CI

- CI (`.github/workflows/ci.yml`): lint, tipos, testes e build em todo PR e na `main`.
- Título do PR checado no padrão Conventional Commits.
- release-please mantém o PR de release com versão e changelog.
