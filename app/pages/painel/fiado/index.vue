<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import { apiErrorMessage } from '~/lib/api-error'
import {
  customerBody,
  identificationLine,
  type Customer,
  type CustomerFormValues,
} from '~/lib/customer'
import { formatDate } from '~/lib/datetime'
import { formatCents } from '~/lib/money'

/**
 * Fiado do painel (`/painel/fiado`, spec 06, seção 8): total a receber, quanto cada cliente
 * deve (mais antigo primeiro), comandas penduradas e a lista de clientes da unidade com busca.
 * Veem o dono e quem tem balcão; cadastrar, editar e remover cliente aqui é do dono (no balcão,
 * o cadastro rápido acontece ao pendurar). Cadastros só com conexão.
 */
useHead({ title: 'Fiado · Varal' })

const session = useSessionStore()
const { $api } = useNuxtApp()
const route = useRoute()
const { unitId, units, select } = usePanelUnit()
/** `?unidade={id}` (link do balcão ou do caixa) escolhe a unidade. */
const unitParam = typeof route.query.unidade === 'string' ? route.query.unidade : null
if (unitParam && units.value.some((unit) => unit.id === unitParam)) select(unitParam)
const receivables = useReceivables(unitId)

const query = ref('')
/** Texto da busca em andamento: o "Carregar mais" continua a mesma busca. */
const searchedText = ref('')

/** Clientes da unidade em ordem de nome, paginados por cursor (spec 06, seção 7). */
const customers = useCursorList<Customer>((page) =>
  $api.GET('/api/v1/units/{id}/customers', {
    params: {
      path: { id: unitId.value ?? '' },
      query: { q: searchedText.value || undefined, ...page },
    },
  }),
)

function loadCustomers() {
  if (!unitId.value) return
  searchedText.value = query.value.trim()
  void customers.reset()
}
const searchSoon = useDebounceFn(loadCustomers, 250)
watch(query, () => void searchSoon())
watch(unitId, loadCustomers, { immediate: true })
useRealtimeResync(() => (unitId.value ? customers.reload() : undefined))

async function search(text: string): Promise<Customer[]> {
  const unit = unitId.value
  if (!unit) return []
  const { data, error } = await $api.GET('/api/v1/units/{id}/customers', {
    params: { path: { id: unit }, query: { q: text || undefined, limit: 50 } },
  })
  if (!data) throw new Error(apiErrorMessage(error))
  return data.data
}

const balanceByCustomer = computed(() => {
  const result: Record<string, number> = {}
  for (const entry of receivables.data.value?.customers ?? []) {
    result[entry.customer.id] = entry.balanceCents
  }
  return result
})

// Cadastro (dono)
const creating = ref(false)
const createAction = useApiAction()
const createKey = useIdempotencyKey()
async function create(values: CustomerFormValues) {
  const unit = unitId.value
  if (!unit) return
  const body = customerBody(values)
  const result = await createAction.run(() =>
    $api.POST('/api/v1/units/{id}/customers', {
      params: { path: { id: unit }, header: { 'Idempotency-Key': createKey.keyFor(body) } },
      body,
    }),
  )
  if (result.ok && result.data) {
    creating.value = false
    createKey.reset()
    await navigateTo(`/painel/fiado/${result.data.id}`)
  }
}
function findSameName(name: string) {
  return search(name)
}
</script>

<template>
  <PanelShell>
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="flex-1 font-display text-2xl font-extrabold">Fiado</h1>
      <AppButton
        v-if="session.isOwner"
        :block="false"
        data-testid="new-customer"
        @click="((createAction.error.value = null), (creating = true))"
      >
        <AppIcon name="plus" />
        Novo cliente
      </AppButton>
    </div>
    <UnitPicker />

    <section class="flex flex-col gap-3" aria-labelledby="receivable-title">
      <div
        class="flex items-baseline justify-between gap-2 rounded-card bg-primary-soft px-4 py-3 text-primary-deep"
      >
        <h2 id="receivable-title" class="text-lg font-bold">A receber</h2>
        <span
          class="font-display text-[2rem] leading-none font-extrabold tabular-nums"
          data-testid="receivable-total"
          >{{ formatCents(receivables.data.value?.totalCents ?? 0) }}</span
        >
      </div>
      <AppAlert v-if="receivables.error.value" tone="error">{{ receivables.error.value }}</AppAlert>
      <p v-if="!receivables.data.value && receivables.loading.value" class="text-text-muted">
        Carregando…
      </p>
      <p
        v-else-if="receivables.data.value && receivables.data.value.customers.length === 0"
        class="text-text-muted"
      >
        Ninguém deve nada nesta unidade.
      </p>
      <ul class="flex flex-col gap-2">
        <li v-for="entry in receivables.data.value?.customers ?? []" :key="entry.customer.id">
          <NuxtLink
            :to="`/painel/fiado/${entry.customer.id}`"
            class="flex min-h-16 items-center gap-3 rounded-card border-2 border-border bg-surface px-4 py-2 hover:border-border-strong"
            data-testid="receivable-customer"
          >
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate font-bold">{{ entry.customer.name }}</span>
              <span class="text-sm text-text-muted">
                {{ entry.tabCount === 1 ? '1 comanda' : `${entry.tabCount} comandas` }} · desde
                {{ formatDate(entry.oldestCreditAt) }}
                <template v-if="identificationLine(entry.customer)">
                  · {{ identificationLine(entry.customer) }}</template
                >
              </span>
            </span>
            <span class="font-display text-lg font-semibold tabular-nums">{{
              formatCents(entry.balanceCents)
            }}</span>
            <AppIcon name="chevron-right" />
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section class="flex flex-col gap-3" aria-labelledby="customers-title">
      <h2 id="customers-title" class="font-display text-xl font-bold">Clientes</h2>
      <label class="flex flex-col gap-1">
        <span class="font-bold">Buscar cliente</span>
        <span
          class="flex items-center gap-2 rounded-button border-2 border-border-strong bg-surface px-3"
        >
          <AppIcon name="search" />
          <input
            v-model="query"
            type="search"
            class="min-h-12 w-full bg-transparent text-base outline-none"
            placeholder="Nome, telefone, CPF ou referência"
            autocomplete="off"
            data-testid="customers-search"
          />
        </span>
      </label>
      <AppAlert v-if="customers.error.value" tone="error">{{ customers.error.value }}</AppAlert>
      <p v-if="customers.loading.value && !customers.error.value" class="text-text-muted">
        Carregando…
      </p>
      <p
        v-else-if="customers.items.value.length === 0 && !customers.error.value"
        class="text-text-muted"
      >
        {{ searchedText ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.' }}
      </p>
      <ul class="flex flex-col gap-2">
        <li v-for="customer in customers.items.value" :key="customer.id">
          <NuxtLink
            :to="`/painel/fiado/${customer.id}`"
            class="flex min-h-14 items-center gap-3 rounded-card border-2 border-border bg-surface px-4 py-2 hover:border-border-strong"
            data-testid="customer-row"
          >
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate font-bold">{{ customer.name }}</span>
              <span class="text-sm text-text-muted">{{
                identificationLine(customer) || 'Sem dados de identificação'
              }}</span>
            </span>
            <span
              v-if="balanceByCustomer[customer.id]"
              class="text-sm font-bold whitespace-nowrap tabular-nums"
              >deve {{ formatCents(balanceByCustomer[customer.id] ?? 0) }}</span
            >
            <AppIcon name="chevron-right" />
          </NuxtLink>
        </li>
      </ul>
      <LoadMoreButton
        v-if="customers.hasMore.value"
        :loading="customers.loadingMore.value"
        @click="customers.loadMore"
      />
    </section>

    <AppDialog v-model:open="creating" title="Novo cliente">
      <CustomerForm
        v-if="creating"
        :busy="createAction.busy.value"
        :error="createAction.error.value"
        :find-same-name="findSameName"
        @submit="create"
      />
    </AppDialog>
  </PanelShell>
</template>
