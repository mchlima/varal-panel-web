<script setup lang="ts">
import type { IconName } from '~/components/AppIcon.vue'
import { apiErrorMessage } from '~/lib/api-error'
import { closeCashTarget, homeAction, tabsCountLabel, unitStatusLabel } from '~/lib/home'
import { formatCents } from '~/lib/money'
import { priceListName, shortDay, sinceLabel, type ContractedEvent } from '~/lib/operation'
import { dayReportPath, todaySummaryQuery } from '~/lib/report'
import { canOperateCashIn } from '~/lib/routes'

/**
 * Início do painel (`/painel`, spec 01, seção 14.2): UMA ação principal, a próxima ação óbvia
 * da unidade (RN-01.24), a partir de `GET /units/{id}/operation` e atualizada em tempo real
 * (`unit.operation_updated`, CA-01.18):
 * - caixa aberto desde um dia anterior → "Fechar caixa" (RN-05.26);
 * - caixa aberto → "Abrir balcão", com os caixas abertos, a tabela vigente ("Trocar"), o evento
 *   em andamento ("Encerrar") e, para o dono, a venda e o recebido parciais de hoje;
 * - nenhum caixa aberto → "Abrir caixa".
 * Abaixo, o aviso das comandas abertas há mais de 2 dias (RN-01.28, CA-01.19) e, em estilo
 * secundário, o resto do painel conforme quem é (RN-01.23).
 */
useHead({ title: 'Início · Varal' })

const session = useSessionStore()
const operations = useOperationStore()
const events = useContractedEventsStore()
const menu = useMenuStore()
const { $api } = useNuxtApp()
const { units: panelUnits, unit: panelUnit, select } = usePanelUnit()
const counter = useOpenCounter()
const now = useClock(60_000)

/** Unidades com início: todas para o dono; as em que o colaborador opera caixa. */
const units = computed(() =>
  panelUnits.value.filter((unit) => session.isOwner || unit.canOperateCash),
)
const unit = computed(
  () => units.value.find((item) => item.id === panelUnit.value?.id) ?? units.value[0] ?? null,
)
const unitId = computed(() => unit.value?.id ?? null)
const { operation, error: operationError } = useUnitOperation(unitId, { trackTabs: true })
const action = computed(() => (operation.value ? homeAction(operation.value, now.value) : null))
const canCash = computed(() => (unitId.value ? canOperateCashIn(session.me, unitId.value) : false))
const firstName = computed(() => session.me?.subject.name.split(' ')[0] ?? '')

// Com mais de uma unidade: resumo de uma linha por unidade (spec 01, seção 14.2).
onMounted(() => {
  for (const item of units.value) {
    if (item.id !== unitId.value && !operations.get(item.id)) void operations.load(item.id)
  }
})

// Evento de hoje e em andamento (spec 04, seção 3.3).
watch(
  unitId,
  (id) => {
    if (id && canCash.value) void events.load(id)
  },
  { immediate: true },
)
const eventToday = computed<ContractedEvent | null>(() => operation.value?.eventsToday[0] ?? null)

// Tabela vigente (RN-04.31): troca com um toque, bloqueada durante evento (RN-04.32).
const switching = ref(false)

// Encerrar o evento em andamento (RN-04.34): confirmação na própria tela.
const finishing = ref(false)
const finishAsk = ref(false)
const finishError = ref('')
async function finishEvent(event: ContractedEvent) {
  finishing.value = true
  finishError.value = ''
  try {
    const { data, error } = await $api.POST('/api/v1/events/{id}/finish', {
      params: { path: { id: event.id } },
      body: { version: event.version },
    })
    if (!data) {
      finishError.value = apiErrorMessage(error)
      return
    }
    events.apply(data)
    finishAsk.value = false
    if (unitId.value) void operations.load(unitId.value)
  } catch (cause) {
    finishError.value = apiErrorMessage(cause)
  } finally {
    finishing.value = false
  }
}

// Venda e recebido parciais de hoje, só para o dono (RN-07.07; spec 07, seção 11).
const today = ref<{ salesCents: number; receivedCents: number; partial: boolean } | null>(null)
let todayGeneration = 0
async function loadToday() {
  const id = unitId.value
  const day = operation.value?.businessDate
  if (!session.isOwner || !id || !day || !operation.value?.inOperation) {
    today.value = null
    return
  }
  const current = ++todayGeneration
  try {
    const { data } = await $api.GET('/api/v1/reports/summary', {
      params: { query: todaySummaryQuery(id, day) },
    })
    if (current !== todayGeneration || !data) return
    today.value = {
      salesCents: data.summary.salesCents,
      receivedCents: data.summary.receivedCents,
      partial: data.partial,
    }
  } catch {
    // Sem rede: o resumo de hoje some até a próxima recarga.
  }
}
watch(
  () => [unitId.value, operation.value?.businessDate, operation.value?.inOperation] as const,
  () => void loadToday(),
  { immediate: true },
)
useRealtimeEvent('tab.updated', (event) => {
  if (event.unitId === unitId.value && ['paid', 'on_credit'].includes(event.data.status)) {
    void loadToday()
  }
})
const todayReport = computed(() => {
  const day = operation.value?.businessDate
  return day && unitId.value ? dayReportPath(unitId.value, day) : '/painel/relatorios'
})

// Primeiros passos (dono sem cardápio): cadastrar produtos e convidar a equipe.
const hasProducts = ref<boolean | null>(null)
const hasStaff = ref<boolean | null>(null)
watch(
  unitId,
  async (id) => {
    if (!session.isOwner || !id) return
    if (await menu.load(id)) {
      hasProducts.value = menu.categories.some((category) => category.products.length > 0)
    }
    try {
      const { data } = await $api.GET('/api/v1/staff', { params: { query: { limit: 1 } } })
      if (data) hasStaff.value = data.data.length > 0
    } catch {
      // Sem rede: o passo fica como está.
    }
  },
  { immediate: true },
)
const firstSteps = computed(() =>
  session.isOwner && hasProducts.value === false
    ? [
        {
          done: false,
          to: '/painel/cardapio',
          title: 'Cadastre os produtos',
          text: 'O que você vende, com preço. Sem isso o balcão não tem o que lançar.',
        },
        {
          done: hasStaff.value === true,
          to: '/painel/colaboradores',
          title: 'Convide a equipe',
          text: 'Cada pessoa entra com o próprio celular, no balcão ou na cozinha.',
        },
      ]
    : [],
)

/** O resto do painel, compacto e conforme quem é (RN-01.23). */
const shortcuts = computed(() => {
  const list: { to: string; title: string; icon: IconName }[] = [
    { to: '/painel/fiado', title: 'Fiado', icon: 'users' },
  ]
  if (session.isOwner) list.push({ to: '/painel/relatorios', title: 'Relatórios', icon: 'chart' })
  if (session.isOwner || events.hasEvents(unitId.value)) {
    list.push({
      to: '/painel/eventos',
      title: session.isOwner ? 'Eventos contratados' : 'Eventos',
      icon: 'party',
    })
  }
  if (session.isOwner) {
    list.push(
      { to: '/painel/cardapio', title: 'Cardápio e tabelas de preço', icon: 'menu' },
      { to: '/painel/unidades', title: 'Unidades e caixas', icon: 'store' },
      { to: '/painel/colaboradores', title: 'Colaboradores', icon: 'users' },
      { to: '/painel/acesso-da-equipe', title: 'Acesso da equipe', icon: 'qr' },
      { to: '/painel/acessos-de-suporte', title: 'Acessos de suporte', icon: 'eye' },
    )
  }
  return list
})

function openCounter() {
  void counter.open(unit.value)
}

/** Link de uma comanda (aviso RN-01.28): o balcão abre na unidade escolhida aqui. */
const workplace = useWorkplaceStore()
function prepareCounter() {
  if (unitId.value && workplace.unitId !== unitId.value) workplace.selectUnit(unitId.value)
}
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl">Olá, {{ firstName }}</h1>
      <p v-if="unit && units.length === 1" class="text-text-muted">{{ unit.name }}</p>
    </div>

    <!-- Mais de uma unidade: escolha (lembrada no aparelho) e resumo de uma linha. -->
    <section v-if="units.length > 1" aria-label="Unidades" class="flex flex-col gap-2">
      <div role="group" aria-label="Unidade" class="flex flex-wrap gap-2">
        <button
          v-for="item in units"
          :key="item.id"
          type="button"
          :aria-pressed="item.id === unitId"
          class="flex min-h-12 flex-col items-start justify-center rounded-button border-2 px-3 py-1 text-left"
          :class="
            item.id === unitId
              ? 'border-primary bg-primary-soft text-primary-deep'
              : 'border-border-strong bg-surface text-text'
          "
          :data-testid="`unit-${item.id}`"
          @click="select(item.id)"
        >
          <span class="font-bold">{{ item.name }}</span>
          <span class="text-sm">{{ unitStatusLabel(operations.get(item.id)) }}</span>
        </button>
      </div>
    </section>

    <AppAlert v-if="units.length === 0">
      Nenhuma unidade ativa.
      <NuxtLink to="/painel/unidades" class="font-bold underline">Abra Unidades</NuxtLink> para
      criar ou ativar uma.
    </AppAlert>

    <!-- Primeiros passos (dono sem cardápio). -->
    <section
      v-if="firstSteps.length"
      aria-label="Primeiros passos"
      class="flex flex-col gap-3 rounded-card border-2 border-border bg-surface p-4"
      data-testid="first-steps"
    >
      <h2 class="text-lg">Primeiros passos</h2>
      <ol class="flex flex-col gap-2">
        <li v-for="(step, index) in firstSteps" :key="step.to">
          <NuxtLink
            :to="step.to"
            class="flex min-h-14 items-center gap-3 rounded-button px-2 py-1 hover:bg-surface-muted"
          >
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-full border-2 font-bold"
              :class="
                step.done
                  ? 'border-status-ready-text bg-status-ready-bg text-status-ready-text'
                  : 'border-border-strong'
              "
            >
              <AppIcon v-if="step.done" name="check" :size="16" />
              <template v-else>{{ index + 1 }}</template>
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="font-bold" :class="step.done ? 'line-through' : ''">{{
                step.title
              }}</span>
              <span class="text-sm text-text-muted">{{ step.text }}</span>
            </span>
            <AppIcon name="chevron-right" />
          </NuxtLink>
        </li>
      </ol>
    </section>

    <AppAlert v-if="operationError && !operation" tone="error">{{ operationError }}</AppAlert>
    <p v-else-if="unit && !operation" class="text-text-muted">Carregando…</p>

    <!-- A ação principal do momento (RN-01.24): o único botão preenchido da tela. -->
    <section
      v-if="operation && action"
      aria-label="Agora"
      class="flex flex-col gap-4 rounded-card border-2 border-border bg-surface p-4"
      data-testid="home-action"
      :data-state="action.kind"
    >
      <template v-if="action.kind === 'close-earlier'">
        <p
          class="flex items-start gap-2 rounded-card bg-status-attention-bg p-3 font-bold text-status-attention-ink"
          data-testid="earlier-register"
        >
          <AppIcon name="alert-triangle" class="mt-0.5" />
          {{ action.register.name }} aberto desde {{ action.since }}
        </p>
        <p class="text-text-muted">
          Feche o caixa que ficou aberto: confira o dinheiro da gaveta e as maquininhas. Depois
          disso o dia novo começa quando o caixa for aberto de novo.
        </p>
        <AppButton :to="`/caixas/${action.register.id}/fechar`" data-testid="primary-action">
          <AppIcon name="wallet" />
          Fechar caixa
        </AppButton>
        <AppButton variant="secondary" @click="openCounter">
          <AppIcon name="receipt" />
          Abrir balcão
        </AppButton>
      </template>

      <template v-else-if="action.kind === 'open-counter'">
        <div class="flex flex-col gap-1">
          <h2 class="text-xl">Caixa aberto: pode vender</h2>
          <ul class="flex flex-col gap-0.5 text-text-muted" data-testid="open-registers">
            <li v-for="register in action.registers" :key="register.id">
              <strong class="text-text">{{ register.name }}</strong>
              · {{ register.session?.openedByName ?? 'Responsável' }} · desde
              {{ sinceLabel(register.session!.openedAt, now) }}
            </li>
          </ul>
        </div>
        <AppButton data-testid="primary-action" @click="openCounter">
          <AppIcon name="receipt" />
          Abrir balcão
        </AppButton>

        <dl class="flex flex-col divide-y divide-border border-t border-border">
          <div class="flex min-h-14 items-center gap-3 py-2">
            <AppIcon name="tag" class="text-primary-deep" />
            <dt class="sr-only">Tabela de preço</dt>
            <dd class="flex-1">
              Preços:
              <strong data-testid="home-price-list">{{
                priceListName(operation.effectivePriceList)
              }}</strong>
              <span v-if="operation.eventInProgress" class="block text-sm text-text-muted">
                Tabela do evento em andamento.
              </span>
            </dd>
            <AppButton
              v-if="canCash"
              variant="ghost"
              :block="false"
              data-testid="switch-price-list"
              @click="switching = true"
            >
              Trocar
            </AppButton>
          </div>
          <div v-if="operation.eventInProgress" class="flex flex-col gap-2 py-2">
            <div class="flex min-h-12 items-center gap-3">
              <AppIcon name="party" class="text-primary-deep" />
              <dt class="sr-only">Evento em andamento</dt>
              <dd class="flex-1">
                Evento: <strong>{{ operation.eventInProgress.contractorName }}</strong>
              </dd>
              <AppButton
                v-if="canCash && !finishAsk"
                variant="ghost"
                :block="false"
                data-testid="finish-event"
                @click="finishAsk = true"
              >
                Encerrar
              </AppButton>
            </div>
            <div
              v-if="finishAsk"
              class="flex flex-col gap-2 rounded-card border-2 border-border-strong p-3"
            >
              <p class="font-bold">
                Encerrar o evento {{ operation.eventInProgress.contractorName }}?
              </p>
              <p class="text-sm text-text-muted">
                As próximas comandas não serão mais do evento e os preços voltam para a tabela
                {{ priceListName(operation.currentPriceList) }}.
              </p>
              <AppAlert v-if="finishError" tone="error">{{ finishError }}</AppAlert>
              <div class="flex flex-wrap gap-2">
                <AppButton
                  variant="secondary"
                  :block="false"
                  :loading="finishing"
                  data-testid="confirm-finish-event"
                  @click="finishEvent(operation.eventInProgress)"
                >
                  Encerrar evento
                </AppButton>
                <AppButton variant="ghost" :block="false" @click="finishAsk = false">
                  Agora não
                </AppButton>
              </div>
            </div>
          </div>
          <div v-if="session.isOwner && today" class="flex min-h-14 items-center gap-3 py-2">
            <AppIcon name="chart" class="text-primary-deep" />
            <dt class="sr-only">Hoje</dt>
            <dd class="flex flex-1 flex-wrap gap-x-4" data-testid="home-today">
              <span
                >Venda hoje
                <strong class="tabular-nums">{{ formatCents(today.salesCents) }}</strong></span
              >
              <span
                >Recebido
                <strong class="tabular-nums">{{ formatCents(today.receivedCents) }}</strong></span
              >
              <span v-if="today.partial" class="text-sm text-text-muted">valores parciais</span>
            </dd>
            <NuxtLink
              :to="todayReport"
              class="inline-flex min-h-12 items-center font-bold text-primary-deep underline-offset-4 hover:underline"
            >
              Ver relatório
            </NuxtLink>
          </div>
        </dl>

        <div class="grid grid-cols-2 gap-2">
          <AppButton variant="secondary" to="/estacoes">
            <AppIcon name="station" />
            Estações
          </AppButton>
          <AppButton
            v-if="canCash"
            variant="secondary"
            :to="closeCashTarget(operation.cashRegisters)"
            data-testid="close-cash"
          >
            <AppIcon name="wallet" />
            Fechar caixa
          </AppButton>
        </div>
      </template>

      <template v-else>
        <div class="flex flex-col gap-1">
          <h2 class="text-xl">Caixa fechado</h2>
          <p class="text-text-muted">
            Para começar a vender, abra o caixa e informe o troco que está na gaveta.
          </p>
        </div>
        <AppButton :to="action.target" data-testid="primary-action">
          <AppIcon name="wallet" />
          Abrir caixa
        </AppButton>
        <ul class="flex flex-col gap-2">
          <li
            v-if="operation.openTabs.fromEarlierDaysCount > 0"
            class="flex items-center gap-2 text-text-muted"
            data-testid="earlier-open-tabs"
          >
            <AppIcon name="receipt" />
            {{ tabsCountLabel(operation.openTabs.fromEarlierDaysCount) }} em aberto de dias
            anteriores ({{ formatCents(operation.openTabs.totalCents) }} no total). Elas continuam
            no balcão.
          </li>
          <li
            v-if="eventToday"
            class="flex items-center gap-2 font-bold text-primary-deep"
            data-testid="event-today"
          >
            <AppIcon name="party" />
            Hoje tem o evento {{ eventToday.contractorName }}. Você pode iniciá-lo ao abrir o caixa.
          </li>
        </ul>
      </template>
    </section>

    <!-- Comandas abertas há mais de 2 dias (RN-01.28, CA-01.19): aviso, não ação principal. -->
    <section
      v-if="operation && operation.staleTabs.length > 0"
      aria-label="Comandas abertas há mais de 2 dias"
      class="flex flex-col gap-2 rounded-card border-2 border-status-attention-ink bg-surface p-4"
      data-testid="stale-tabs"
    >
      <h2 class="flex items-center gap-2 text-lg text-status-attention-ink">
        <AppIcon name="alert-triangle" />
        Comandas abertas há mais de 2 dias
      </h2>
      <p class="text-sm text-text-muted">
        Receba, pendure no fiado ou cancele para elas saírem daqui.
      </p>
      <ul class="flex flex-col divide-y divide-border">
        <li v-for="tab in operation.staleTabs" :key="tab.id">
          <NuxtLink
            :to="`/balcao/comandas/${tab.number}`"
            class="flex min-h-14 items-center gap-3 py-2"
            :data-testid="`stale-tab-${tab.number}`"
            @click="prepareCounter"
          >
            <span class="min-w-10 font-display text-xl font-extrabold tabular-nums">{{
              tab.number
            }}</span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate font-bold">{{ tab.customerName }}</span>
              <span class="text-sm text-text-muted">desde {{ shortDay(tab.businessDate) }}</span>
            </span>
            <span class="font-bold tabular-nums">{{ formatCents(tab.totalCents) }}</span>
            <AppIcon name="chevron-right" />
          </NuxtLink>
        </li>
      </ul>
    </section>

    <!-- O resto do painel, compacto (spec 01, seção 14.2). -->
    <nav aria-label="Outras telas" class="flex flex-col gap-2">
      <h2 class="text-base text-text-muted">Outras telas</h2>
      <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <li v-for="item in shortcuts" :key="item.to">
          <NuxtLink
            :to="item.to"
            class="flex min-h-12 items-center gap-3 rounded-button border border-border bg-surface px-3 hover:border-primary"
          >
            <AppIcon :name="item.icon" class="text-primary-deep" />
            <span class="flex-1 font-bold">{{ item.title }}</span>
            <AppIcon name="chevron-right" :size="16" />
          </NuxtLink>
        </li>
      </ul>
    </nav>
    <InstallHint />

    <PriceListSwitcher
      v-if="operation && unitId && canCash"
      v-model:open="switching"
      :unit-id="unitId"
      :operation="operation"
    />
    <CounterChooser
      :choices="counter.choices.value"
      @choose="counter.go"
      @close="counter.choices.value = null"
    />
  </PanelShell>
</template>
