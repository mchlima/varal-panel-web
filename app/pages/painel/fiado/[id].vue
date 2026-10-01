<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
import {
  customerBody,
  customerToForm,
  formatCpf,
  formatPhone,
  receivableBlockMessage,
  type CustomerDetail,
  type CustomerFormValues,
} from '~/lib/customer'
import { formatDate, formatTime } from '~/lib/datetime'
import { formatCents } from '~/lib/money'
import { TAB_STATUS_LABELS, type TabSummary } from '~/lib/operation'
import { PAYMENT_METHOD_LABELS, isActivePayment } from '~/lib/payment'

/**
 * Cliente do fiado (`/painel/fiado/{id}`, spec 06, seção 8): dados de identificação, saldo, as
 * comandas penduradas e quitadas e o histórico de quitações. "Quitar" e "Estornar" abrem a tela
 * de receber da comanda (quitação parcial permitida, RN-06.10; estorno, RN-06.12). Editar e
 * remover (anonimizar, RN-06.03) só o dono e só com conexão; com fiado a receber a API recusa
 * (`CUSTOMER_HAS_RECEIVABLE`, CA-06.05) e a tela explica por quê.
 */
const route = useRoute()
const session = useSessionStore()
const workplace = useWorkplaceStore()
const { $api } = useNuxtApp()
const id = computed(() => String(route.params.id))

const customer = ref<CustomerDetail | null>(null)
const loadError = ref('')
const notFound = ref(false)

useHead({ title: () => `${customer.value?.name ?? 'Cliente'} · Fiado · Varal` })

async function load() {
  loadError.value = ''
  try {
    const { data, error, response } = await $api.GET('/api/v1/customers/{id}', {
      params: { path: { id: id.value } },
    })
    if (data) {
      customer.value = data
      notFound.value = false
    } else if (response.status === 404) {
      notFound.value = true
    } else {
      loadError.value = apiErrorMessage(error)
    }
  } catch (cause) {
    loadError.value = apiErrorMessage(cause)
  }
}
watch(id, () => void load(), { immediate: true })
useRealtimeResync(() => load())
useRealtimeEvent('tab.updated', (event) => {
  if (event.data.customer?.id === id.value) void load()
})

const removed = computed(() => !!customer.value?.removedAt)
const openTabs = computed(() =>
  (customer.value?.tabs ?? []).filter((tab) => tab.status === 'on_credit'),
)
const settledTabs = computed(() =>
  (customer.value?.tabs ?? []).filter((tab) => tab.status !== 'on_credit'),
)
const tabNumberById = computed(() => {
  const result: Record<string, TabSummary> = {}
  for (const tab of customer.value?.tabs ?? []) result[tab.id] = tab
  return result
})

/**
 * A tela de receber é do balcão: se este aparelho não está num balcão da unidade da comanda,
 * escolhe o primeiro balcão dela antes de abrir.
 */
async function openReceive(tab: Pick<TabSummary, 'id' | 'number' | 'unitId'>) {
  const unit = session.me?.units.find((item) => item.id === tab.unitId)
  const counters = unit?.stations.filter((station) => station.kind === 'counter') ?? []
  if (unit && !counters.some((station) => station.id === workplace.stationId)) {
    const first = counters[0]
    if (first) {
      workplace.selectUnit(unit.id)
      workplace.selectStation(first.id)
    }
  }
  await navigateTo(`/balcao/comandas/${tab.number}/receber?comanda=${tab.id}`)
}

// Edição (dono)
const editing = ref(false)
const editAction = useApiAction()
async function save(values: CustomerFormValues) {
  const current = customer.value
  if (!current) return
  const result = await editAction.run(() =>
    $api.PATCH('/api/v1/customers/{id}', {
      params: { path: { id: current.id } },
      body: { ...customerBody(values), version: current.version },
    }),
  )
  if (result.ok) {
    editing.value = false
    await load()
  }
}

// Remoção a pedido (RN-06.03)
const removeAction = useApiAction()
const removeMessage = computed(() => {
  const error = removeAction.error.value
  if (error?.code !== 'CUSTOMER_HAS_RECEIVABLE') return null
  const balance = typeof error.details.balanceCents === 'number' ? error.details.balanceCents : null
  return receivableBlockMessage(balance, formatCents)
})
async function remove() {
  const current = customer.value
  if (!current) return
  const result = await removeAction.run(() =>
    $api.DELETE('/api/v1/customers/{id}', { params: { path: { id: current.id } } }),
  )
  if (result.ok) await load()
}
</script>

<template>
  <PanelShell>
    <NuxtLink
      to="/painel/fiado"
      class="flex min-h-12 items-center gap-2 self-start font-bold text-primary-deep"
    >
      <AppIcon name="arrow-left" />
      Fiado
    </NuxtLink>
    <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
    <AppAlert v-if="notFound" tone="error">Cliente não encontrado.</AppAlert>
    <p v-else-if="!customer && !loadError" class="text-text-muted">Carregando…</p>

    <template v-if="customer">
      <header class="flex flex-col gap-2">
        <h1 class="font-display text-2xl font-extrabold" data-testid="customer-name">
          {{ customer.name }}
        </h1>
        <StatusChip v-if="removed" tone="inactive" label="Removido a pedido" />
        <dl v-else class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <template v-if="customer.reference">
            <dt class="text-text-muted">Referência</dt>
            <dd>{{ customer.reference }}</dd>
          </template>
          <template v-if="customer.phone">
            <dt class="text-text-muted">Telefone</dt>
            <dd>{{ formatPhone(customer.phone) }}</dd>
          </template>
          <template v-if="customer.cpf">
            <dt class="text-text-muted">CPF</dt>
            <dd>{{ formatCpf(customer.cpf) }}</dd>
          </template>
          <template v-if="customer.note">
            <dt class="text-text-muted">Observação</dt>
            <dd>{{ customer.note }}</dd>
          </template>
        </dl>
      </header>

      <div
        class="flex items-baseline justify-between gap-2 rounded-card bg-primary-soft px-4 py-3 text-primary-deep"
      >
        <span class="text-lg font-bold">Deve</span>
        <span
          class="font-display text-[2rem] leading-none font-extrabold tabular-nums"
          data-testid="customer-balance"
          >{{ formatCents(customer.balanceCents) }}</span
        >
      </div>

      <section class="flex flex-col gap-2" aria-labelledby="open-tabs-title">
        <h2 id="open-tabs-title" class="font-display text-xl font-bold">No fiado</h2>
        <p v-if="openTabs.length === 0" class="text-text-muted">Nenhuma comanda pendurada.</p>
        <ul class="flex flex-col gap-2">
          <li
            v-for="tab in openTabs"
            :key="tab.id"
            class="flex flex-wrap items-center gap-3 rounded-card border-2 border-border bg-surface px-4 py-3"
            data-testid="customer-open-tab"
          >
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="font-bold">Comanda {{ tab.number }} · {{ tab.customerName }}</span>
              <span class="text-sm text-text-muted">
                Pendurada em {{ tab.creditAt ? formatDate(tab.creditAt) : '—' }} · total
                {{ formatCents(tab.totalCents) }}
              </span>
            </span>
            <span class="font-display text-lg font-semibold tabular-nums">{{
              formatCents(tab.balanceCents)
            }}</span>
            <AppButton :block="false" data-testid="settle-tab" @click="openReceive(tab)">
              Quitar
            </AppButton>
          </li>
        </ul>
      </section>

      <section class="flex flex-col gap-2" aria-labelledby="settlements-title">
        <h2 id="settlements-title" class="font-display text-xl font-bold">Quitações</h2>
        <p v-if="customer.settlements.length === 0" class="text-text-muted">
          Nenhuma quitação ainda.
        </p>
        <ul class="flex flex-col gap-2">
          <li
            v-for="payment in customer.settlements"
            :key="payment.id"
            class="flex flex-wrap items-center gap-2 rounded-card border-2 border-border bg-surface px-4 py-2"
            data-testid="settlement-row"
          >
            <span class="flex min-w-0 flex-1 flex-col">
              <span
                class="font-bold"
                :class="isActivePayment(payment) ? '' : 'text-text-muted line-through'"
                >{{ PAYMENT_METHOD_LABELS[payment.method] }} ·
                {{ formatCents(payment.amountCents) }}</span
              >
              <span class="text-sm text-text-muted">
                {{ formatDate(payment.createdAt) }} {{ formatTime(payment.createdAt) }} · comanda
                {{ payment.tabNumber }}
              </span>
            </span>
            <StageChip
              v-if="!isActivePayment(payment)"
              status="canceled"
              :label="`Estornado${payment.reversalReason ? `: ${payment.reversalReason}` : ''}`"
            />
            <AppButton
              v-else-if="tabNumberById[payment.tabId]"
              variant="ghost"
              :block="false"
              @click="openReceive(tabNumberById[payment.tabId]!)"
            >
              Ver ou estornar
            </AppButton>
          </li>
        </ul>
      </section>

      <section
        v-if="settledTabs.length"
        class="flex flex-col gap-2"
        aria-labelledby="history-title"
      >
        <h2 id="history-title" class="font-display text-xl font-bold">Comandas quitadas</h2>
        <ul class="flex flex-col gap-2">
          <li
            v-for="tab in settledTabs"
            :key="tab.id"
            class="flex items-center gap-3 rounded-card border-2 border-border bg-surface px-4 py-2"
          >
            <span class="flex-1">
              Comanda {{ tab.number }} · {{ formatCents(tab.totalCents) }}
              <span class="block text-sm text-text-muted"
                >{{ TAB_STATUS_LABELS[tab.status] }}
                <template v-if="tab.settledAt"> em {{ formatDate(tab.settledAt) }}</template></span
              >
            </span>
          </li>
        </ul>
      </section>

      <section
        v-if="session.isOwner && !removed"
        class="flex flex-col gap-3 border-t border-border pt-4"
        aria-label="Cadastro do cliente"
      >
        <AppButton variant="secondary" data-testid="edit-customer" @click="editing = true">
          <AppIcon name="edit" />
          Editar dados
        </AppButton>
        <ConfirmAction
          label="Remover cliente"
          :question="`Remover ${customer.name}? Nome e dados de identificação são apagados (LGPD) e as comandas ficam no histórico como &quot;Cliente removido&quot;.`"
          confirm-label="Remover"
          :loading="removeAction.busy.value"
          data-testid="remove-customer"
          @confirm="remove"
        >
          <template #icon><AppIcon name="trash" /></template>
        </ConfirmAction>
        <AppAlert v-if="removeMessage" tone="error">
          <p class="font-bold" data-testid="remove-blocked">{{ removeMessage }}</p>
        </AppAlert>
        <ErrorAlert v-else :error="removeAction.error.value" />
      </section>
    </template>

    <AppDialog v-model:open="editing" title="Editar cliente">
      <CustomerForm
        v-if="editing && customer"
        :initial="customerToForm(customer)"
        :busy="editAction.busy.value"
        :error="editAction.error.value"
        submit-label="Salvar"
        @submit="save"
      />
    </AppDialog>
  </PanelShell>
</template>
