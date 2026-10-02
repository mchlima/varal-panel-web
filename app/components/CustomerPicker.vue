<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import { apiErrorMessage } from '~/lib/api-error'
import {
  customerBody,
  emptyCustomerForm,
  identificationLine,
  type Customer,
  type CustomerFormValues,
} from '~/lib/customer'

/**
 * Escolha do cliente ao pendurar (RN-06.02): busca por nome, telefone, CPF ou referência; cada
 * resultado mostra os dados de identificação que tiver, para não confundir homônimos. Sem o
 * cliente na lista, o cadastro rápido pede só o nome (RN-06.01).
 *
 * Busca e cadastro precisam de conexão: o cliente novo precisa do id da API antes de a comanda
 * ser pendurada (o pendurar em si vai pela fila).
 */
const props = defineProps<{ unitId: string }>()
const emit = defineEmits<{ choose: [customer: Customer] }>()

const { $api } = useNuxtApp()
const connection = useConnectionStore()
const query = ref('')
/** Texto da busca em andamento: o "Carregar mais" continua a mesma busca. */
const searchedText = ref('')
const offlineError = ref('')
const creating = ref(false)
const action = useApiAction()
const idempotency = useIdempotencyKey()

/** Página de clientes da busca, em ordem de nome, paginada por cursor (spec 06, seção 7). */
const PICKER_PAGE = 20
const list = useCursorList<Customer>(
  (page) =>
    $api.GET('/api/v1/units/{id}/customers', {
      params: { path: { id: props.unitId }, query: { q: searchedText.value, ...page } },
    }),
  { pageSize: PICKER_PAGE },
)
const searched = computed(() => query.value.trim() !== '' && !list.loading.value)
const error = computed(() => offlineError.value || list.error.value)

async function search(text: string): Promise<Customer[]> {
  const { data, error: failure } = await $api.GET('/api/v1/units/{id}/customers', {
    params: { path: { id: props.unitId }, query: { q: text, limit: 50 } },
  })
  if (!data) throw new Error(apiErrorMessage(failure))
  return data.data
}

async function runSearch() {
  offlineError.value = ''
  searchedText.value = query.value.trim()
  if (!searchedText.value) {
    list.clear()
    return
  }
  if (!connection.online) {
    list.clear()
    offlineError.value = 'Sem conexão: a busca de clientes precisa de internet.'
    return
  }
  await list.reset()
}
const searchSoon = useDebounceFn(runSearch, 250)
watch(query, () => void searchSoon())

function startCreate() {
  action.clear()
  creating.value = true
}

async function create(values: CustomerFormValues) {
  const body = customerBody(values)
  const result = await action.run(() =>
    $api.POST('/api/v1/units/{id}/customers', {
      params: {
        path: { id: props.unitId },
        header: { 'Idempotency-Key': idempotency.keyFor(body) },
      },
      body,
    }),
  )
  if (result.ok && result.data) emit('choose', result.data)
}

/** Para o aviso de homônimo: clientes com o nome exato (a busca é por trecho). */
function findSameName(name: string) {
  return search(name)
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="customer-picker">
    <template v-if="!creating">
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
            data-testid="customer-search"
          />
        </span>
      </label>
      <p class="min-h-lh text-sm text-text-muted" role="status">
        <template v-if="query.trim() && list.loading.value && !error">Buscando…</template>
        <template v-else-if="error"
          ><span class="text-error">{{ error }}</span></template
        >
        <template v-else-if="searched && list.items.value.length === 0">
          Nenhum cliente encontrado. Cadastre abaixo.
        </template>
      </p>
      <ul v-if="list.items.value.length" class="flex flex-col gap-2">
        <li v-for="customer in list.items.value" :key="customer.id">
          <button
            type="button"
            class="flex min-h-14 w-full flex-col items-start gap-0.5 rounded-card border-2 border-border bg-surface px-3 py-2 text-left hover:border-primary"
            data-testid="customer-result"
            @click="emit('choose', customer)"
          >
            <span class="font-bold">{{ customer.name }}</span>
            <span class="text-sm text-text-muted">
              {{ identificationLine(customer) || 'Sem dados de identificação' }}
            </span>
          </button>
        </li>
      </ul>
      <LoadMoreButton
        v-if="list.hasMore.value"
        :loading="list.loadingMore.value"
        @click="list.loadMore"
      />
      <AppButton
        variant="secondary"
        :disabled="!connection.online"
        data-testid="customer-new"
        @click="startCreate"
      >
        <AppIcon name="plus" />
        Cadastrar cliente novo
      </AppButton>
      <p v-if="!connection.online" class="text-sm text-text-muted">
        Sem conexão: buscar e cadastrar cliente precisam de internet.
      </p>
    </template>
    <template v-else>
      <CustomerForm
        :initial="emptyCustomerForm(query.trim())"
        :busy="action.busy.value"
        :error="action.error.value"
        :find-same-name="findSameName"
        submit-label="Cadastrar e escolher"
        @submit="create"
      />
      <AppButton variant="ghost" @click="creating = false">Voltar à busca</AppButton>
    </template>
  </div>
</template>
