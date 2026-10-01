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
const results = ref<Customer[]>([])
const searched = ref(false)
const loading = ref(false)
const error = ref('')
const creating = ref(false)
const action = useApiAction()
const idempotency = useIdempotencyKey()
let generation = 0

async function search(text: string): Promise<Customer[]> {
  const { data, error: failure } = await $api.GET('/api/v1/units/{id}/customers', {
    params: { path: { id: props.unitId }, query: { q: text, limit: 20 } },
  })
  if (!data) throw new Error(apiErrorMessage(failure))
  return data.data
}

async function runSearch() {
  const text = query.value.trim()
  const current = ++generation
  if (!text) {
    results.value = []
    searched.value = false
    return
  }
  if (!connection.online) {
    error.value = 'Sem conexão: a busca de clientes precisa de internet.'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const found = await search(text)
    if (current !== generation) return
    results.value = found
    searched.value = true
  } catch (cause) {
    if (current === generation) error.value = apiErrorMessage(cause)
  } finally {
    if (current === generation) loading.value = false
  }
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
        <template v-if="loading">Buscando…</template>
        <template v-else-if="error"
          ><span class="text-error">{{ error }}</span></template
        >
        <template v-else-if="searched && results.length === 0">
          Nenhum cliente encontrado. Cadastre abaixo.
        </template>
      </p>
      <ul v-if="results.length" class="flex flex-col gap-2">
        <li v-for="customer in results" :key="customer.id">
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
