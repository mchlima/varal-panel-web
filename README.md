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

| Rota                          | Tela                                                                                                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/entrar`                     | Login com abas "Sou dono" (e-mail e senha) e "Sou colaborador" (código, usuário e senha). `?aba=colaborador` abre na segunda aba                                                                                                                                             |
| `/e/{codigo}`                 | Login do colaborador com o código preenchido e o nome da barraca no topo (`GET /auth/access-code/{code}`); código inválido mostra aviso (CA-01.03)                                                                                                                           |
| `/esqueci-a-senha`            | Pedido de redefinição do dono; mensagem sempre igual (RN-01.03)                                                                                                                                                                                                              |
| `/definir-senha`              | Convite e redefinição: lê `token` e `tipo` do fragmento (`#token=...&tipo=convite\|redefinicao`), apaga o fragmento da barra de endereço, exige 8+ caracteres e confirmação                                                                                                  |
| `/entrar-como`                | Troca o link do "entrar como" (`#token=...`) por uma sessão do app como o dono e abre o `/painel` (spec 02, RN-02.21)                                                                                                                                                        |
| `/estacoes`                   | Escolha de unidade (se houver mais de uma) e de estação entre as do `/auth/me`, com nome e tipo reais (todas para o dono, as liberadas para o colaborador). Balcão de pedidos leva ao `/balcao`; fila, ao `/estacao/{id}`. Sem estações, "Nenhuma estação configurada ainda" |
| `/painel`                     | Início do painel do dono, com atalhos para as seções                                                                                                                                                                                                                         |
| `/painel/unidades`            | Unidades: lista, criar (com o template padrão), renomear, tempo de atraso (1 a 240 min), ativar e desativar (`LAST_ACTIVE_UNIT` e `SHIFT_OPEN` explicados)                                                                                                                   |
| `/painel/unidades/{id}/fluxo` | Estações (criar, renomear, tipo, ordem, ativar/desativar com `STATION_IN_USE` explicado) e editor do fluxo de etapas (ordem, destino, etapa final), com validação local das RN-03.05/06, problemas de `INVALID_WORKFLOW` por etapa e conflito de `version` com "Recarregar"  |
| `/painel/cardapio`            | Categorias em abas, produtos com preço, estação e esgotado; ordenação por arrasto (com ↑/↓); editor de produto com grupos de modificadores. Com mais de uma unidade, escolhe a unidade no topo                                                                               |
| `/painel/colaboradores`       | Lista com situação; cadastro; permissões por unidade (estações e caixa); redefinir senha (e-mail se houver, copiar link, WhatsApp); definir senha direto; desativar e reativar                                                                                               |
| `/painel/acesso-da-equipe`    | Código, link `/e/{codigo}` com "Copiar link" e QR grande (SVG da API, mostrado como imagem)                                                                                                                                                                                  |
| `/painel/acessos-de-suporte`  | Acessos de suporte ("entrar como") feitos na conta: admin, motivo, início e fim (RN-02.22)                                                                                                                                                                                   |
| `/balcao`, `/estacao/{id}`    | Provisórias até a spec 04: nome da estação, aviso honesto do que falta e o atalho de esgotado do cardápio                                                                                                                                                                    |

O middleware `app/middleware/auth.global.ts` leva páginas protegidas sem sessão para `/entrar`, quem já está logado do login para o início (`/painel` do dono, `/estacoes` do colaborador) e o colaborador para fora de `/painel`.

Componentes próprios em `app/components` (`AppButton`, `AppTextField`, `AppSelect`, `AppCheckbox`, `AppAlert`, `AppIcon`, `StatusChip`, `ConfirmAction`, `SortableList`…), com Reka UI nas abas e nos painéis de edição (`AppDialog`: tela cheia no celular, janela a partir de 1024 px). O painel usa `PanelShell`: navegação lateral a partir de 1024 px e menu inferior abaixo disso (spec 08, seção 7). Uma única ação principal (botão preenchido) por tela, alvos de 48 px ou mais, foco visível e cores só dos tokens (spec 08).

## Configuração da unidade (spec 03)

- **Dinheiro:** `app/lib/money.ts` lê reais digitados ("12,50", "1.234,56", "12.5") e devolve centavos inteiros (`parseReais`), sem ponto flutuante; `formatCents` mostra "R$ 12,50". A API recebe sempre `priceCents`/`priceDeltaCents`.
- **Fluxo:** `app/lib/workflow.ts` repete a validação da API (`validateWorkflow`: 2 a 8 etapas, só a última final, estação fixa de fila ativa, nomes sem repetir), com os mesmos códigos e mensagens de `INVALID_WORKFLOW`. O editor mostra os problemas por etapa e não envia um fluxo inválido; os problemas da API aparecem do mesmo jeito. O `PUT` leva a `version` da unidade; `VERSION_CONFLICT` oferece "Recarregar". Se a versão sobe sem mudar as etapas (estação renomeada), o rascunho só atualiza a versão; se outro aparelho mudou o fluxo, a tela avisa.
- **Turno aberto (RN-03.07):** a tela de fluxo sempre explica que estações e fluxo travam com turno aberto; ainda não há turnos (spec 04), então o aviso não sabe se há um aberto. O `SHIFT_OPEN` da API aparece com a dica de fechar o turno.
- **Escrita online x fila offline (decisão):** só o **esgotado** é operacional (RN-03.11, feito do balcão e das estações a qualquer hora) e vai pela fila offline (`useSoldOut` → `POST/DELETE /products/{id}/sold-out` com `Idempotency-Key`), com "Enviando…" até o evento confirmar. Os **cadastros** (unidades, estações, fluxo, cardápio, colaboradores) são online: sem conexão, a tela diz "Alterações de cadastro precisam de internet" e não envia (`useApiAction`). As criações (`POST`) mandam `Idempotency-Key`, reaproveitada enquanto o formulário enviar o mesmo conteúdo, para um reenvio não duplicar.
- **Cardápio compartilhado:** a store `useMenuStore` guarda o cardápio da unidade (e as estações, para o dono). O atalho de esgotado (`SoldOutToggle`, `MenuSoldOutList`) serve o cardápio do painel e as telas provisórias do balcão e das estações.
- **Listas:** `GET /units` e `GET /staff` são paginados, mas o `openapi.json` ainda não publica `limit`/`cursor`; as telas mostram a primeira página (50) e avisam se houver mais.

## Admin da plataforma: lado do dono (spec 02)

- **"Entrar como" (RN-02.17 a RN-02.22):** o admin gera no `varal-admin-web` o link `{PANEL_URL}/entrar-como#token=...` (uso único, 2 minutos). A página lê o token do fragmento, apaga-o da barra de endereço, chama `POST /auth/impersonation` com o `X-Device-Id` (o navegador manda junto a sessão do admin, exigida pela API), confere o `/auth/me` e abre o `/painel`. Erros com mensagem própria: link usado ou vencido (`INVALID_IMPERSONATION_TOKEN`) e link aberto em outro navegador (401, sem a sessão do admin). Essa rota não passa pela renovação automática (um 401 dela não é sessão do app vencida).
- **Faixa do "entrar como" (RN-02.19):** `ImpersonationBanner`, no topo fixo de todas as telas (em `app.vue`, junto com a faixa de conexão), enquanto o `/auth/me` trouxer `impersonation`: "Você está acessando como {organização} — {admin}", tempo restante e "Encerrar acesso". Cor própria (fundo `text`, quase preto, texto `surface` e borda na primária), para não parecer aviso comum (spec 08, "faixa de aviso"). "Encerrar acesso" é o `POST /auth/logout` desta sessão (fica desabilitado enquanto houver ações na fila, como o "Sair", que some durante o acesso) e volta ao `/entrar` com o aviso "Acesso de suporte encerrado". No fim dos 60 minutos o app recarrega o `/auth/me`, a renovação é recusada e ele volta ao login; encerrado pelo admin, chega `session.revoked` no tempo real. A altura das faixas do topo vai para `--top-banners`, usada pela navegação lateral do painel.
- **Situação da organização (RN-02.12, CA-02.05):** `OrganizationStatusBanner` no painel do dono, em `suspended` e `canceled`, com o motivo (`organization.suspendedReason`) e a explicação de que não é possível abrir turno.
- **Comunicados (RN-02.16, CA-02.06):** `AnnouncementsBanner` no topo do painel, com os não lidos de `GET /announcements/unread` (recarregados ao abrir o painel, no máximo uma vez por minuto, e a cada reconexão do tempo real). O dono abre, lê e marca como lido (`POST /announcements/{id}/read`), e o comunicado some da faixa. No "entrar como" a leitura não é registrada: o botão vira "Fechar", a interface não chama a API e o comunicado só fica escondido nesta sessão.
- **Markdown seguro:** `app/lib/markdown.ts` transforma o texto numa árvore com parágrafos, títulos, listas, negrito, itálico, código e links (só `http`, `https` e `mailto`, abertos com `rel="noopener noreferrer nofollow"`); `MarkdownView` desenha essa árvore com elementos do Vue, sem `v-html`. HTML no texto aparece como texto.

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
- `session.access_changed` (permissões, unidade ou estação mudaram) → no `io server disconnect` seguinte, recarrega o `/auth/me` e reconecta, sem renovar a sessão (as salas novas valem na hora).
- Eventos de unidade: `realtime.subscribe(evento, handler)` vale também para sockets criados depois; nas telas, `useRealtimeEvent(...)`. `unit.config_updated` recarrega o `/auth/me` em qualquer tela e a lista de unidades, a tela de fluxo, o cardápio (nomes de estação) e a lista de colaboradores; `menu.updated` recarrega o cardápio; `product.sold_out_changed` bloqueia ou libera o produto sem recarregar (CA-03.05). Eventos com `version` menor ou igual à conhecida são ignorados.
- O cabeçalho mostra "Conectado", "Conectando…" ou "Sem conexão", sempre com ícone e texto.

## Fila offline (spec 01, seção 11)

`app/lib/offline-queue.ts` (Dexie, banco `varal`, tabela `queue`). A primeira ação operacional é o esgotado (spec 03); as das specs 04 e 05 usam o mesmo caminho:

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

- `pnpm test` (Vitest, entra na CI): sessão e renovação única, fila com `fake-indexeddb` (CA-01.07: ação feita sem conexão é enviada uma única vez quando a conexão volta), `deviceId`, cliente de tempo real com socket falso, telas de acesso, indicador de conexão e aviso de versão nova. Da spec 03: reais ↔ centavos, validação do fluxo (RN-03.05/06, CA-03.02), limites de modificadores (RN-03.13), erros explicados, `session.access_changed` e eventos de unidade no cliente de tempo real, `/estacoes` com estações reais, editor do fluxo (problemas locais e da API, conflito de versão), lista ordenável por botões, esgotado pela fila e eventos fora de ordem, editor de produto (preço em centavos) e redefinição de senha com as três opções. Da spec 02: `/entrar-como` (token do fragmento, erros de link usado e de outro navegador), faixa do "entrar como" (texto, tempo restante, "Encerrar acesso", fim dos 60 minutos), faixa de suspensão, comunicados (marcar como lido; no "entrar como" não chama a API) e o markdown seguro (sem HTML cru, links perigosos viram texto).
- `pnpm test:e2e` (Playwright, **fora da CI** porque precisa da API rodando): projetos `android` (Pixel 7, Chromium) e `iphone` (iPhone 15, WebKit).

### Testes de ponta a ponta

1. Suba a API de um worktree do `varal-web-api` (`scripts/worktree.sh new ...` cria banco e seed; depois `pnpm dev`), com a porta deste painel em `CORS_ORIGINS` e `PANEL_URL=http://localhost:<porta do painel>` no `.env.local` dela (os links de convite e do "entrar como" usam o `PANEL_URL`).
2. Aqui, `NUXT_PUBLIC_API_BASE_URL=http://localhost:<porta da API>` no `.env.local`.
3. `pnpm exec playwright install chromium webkit` (uma vez) e `pnpm test:e2e`. O Playwright sobe o `pnpm dev` se o painel não estiver rodando. Para o teste do service worker, rode `pnpm generate` antes (sem build ele é pulado).

Cobertura: login do dono, login do colaborador por `/e/{codigo}` (CA-01.03), código inválido, renovação ao perder o token de acesso, `session.revoked` levando ao login, indicador "Sem conexão" (`context.setOffline`), "esqueci a senha" lendo o e-mail no Mailpit (`MAILPIT_URL`, padrão `http://localhost:8025`) e definindo a senha pelo link, validações de `/definir-senha`, instrução de instalação no iPhone e app abrindo do cache sem rede. Da spec 03 (`setup.spec.ts`): dono cria estação e edita o fluxo (validação local, salvar, tirar etapa), cria produto com grupo de modificadores e marca esgotado, que chega ao celular da cozinha em até 2 s (CA-03.05) e é liberado de volta por lá; colaborador vê só as estações liberadas, com nome e tipo (RN-03.16); acesso da equipe com código, link e QR. Da spec 02 (`admin-owner-side.spec.ts`, com o admin do seed logado pela API no mesmo navegador): "entrar como" de ponta a ponta, com a faixa em todas as telas, categoria criada no acesso gravada na auditoria com o admin em `impersonator_id` (CA-02.07), link de uso único, "Encerrar acesso" e sessão recusada depois, e a lista de acessos do dono (CA-02.09); link aberto em outro navegador recusado; admin encerrando o acesso derruba o painel na hora (RN-02.21, CA-02.08); comunicado que aparece e some depois de lido (CA-02.06); faixa de suspensão com o motivo (CA-02.05), reativando a organização ao final. O vencimento real de 60 minutos é coberto pelos testes da API; aqui, pelo teste da faixa. Os nomes criados levam um sufixo, para a suíte rodar de novo no mesmo banco.

**Limitação do WebKit:** os cookies da sessão são `Secure` (`__Host-`/`__Secure-`). O Chromium aceita esses cookies em `http://localhost`; o WebKit do Playwright no Linux não os guarda em http. Por isso os testes que dependem da sessão rodam só no projeto `android`; no `iphone` rodam as telas abertas. Em produção (https) o Safari funciona normalmente. A API limita "esqueci a senha" a 5 pedidos por IP a cada 15 minutos e 3 links por usuário por hora (RN-01.02): rodar a suíte muitas vezes seguidas pode pular o teste do Mailpit.

## Identidade visual

Tokens de cor, status, tipografia e cantos da spec 08 ficam em `app/assets/css/tokens.css`, no `@theme` do Tailwind (a paleta padrão do Tailwind é removida). Logo e ícones em `public/` são cópias de `varal-docs/docs/brand/` (RN-08.01): mudanças são feitas lá e copiadas para cá.

## Versões e CI

- CI (`.github/workflows/ci.yml`): lint, tipos, testes e build em todo PR e na `main`.
- Título do PR checado no padrão Conventional Commits.
- release-please mantém o PR de release com versão e changelog.
