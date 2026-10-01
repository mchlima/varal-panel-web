<script setup lang="ts">
import {
  CUSTOMER_NAME_MAX,
  CUSTOMER_NOTE_MAX,
  CUSTOMER_REFERENCE_MAX,
  customerErrorField,
  emptyCustomerForm,
  hasErrors,
  homonymsWithoutIdentification,
  identificationLine,
  validateCustomerForm,
  type Customer,
  type CustomerFormValues,
} from '~/lib/customer'
import type { ExplainedError } from '~/lib/setup'

/**
 * Cadastro e edição de cliente do fiado (RN-06.01, RN-06.02): só o nome é obrigatório;
 * telefone, CPF, referência e observação são opcionais e servem para diferenciar homônimos.
 * Cada campo tem a linha de erro reservada. No cadastro, antes de enviar, busca o nome
 * (`findSameName`): se já houver cliente com esse nome e o novo não tiver telefone, CPF nem
 * referência, avisa e sugere preencher a referência (decisão da fase 6: o aviso é do app).
 */
const props = withDefaults(
  defineProps<{
    initial?: CustomerFormValues
    busy?: boolean
    error?: ExplainedError | null
    submitLabel?: string
    findSameName?: ((name: string) => Promise<Customer[]>) | null
  }>(),
  {
    initial: () => emptyCustomerForm(),
    busy: false,
    error: null,
    submitLabel: 'Cadastrar cliente',
    findSameName: null,
  },
)
const emit = defineEmits<{ submit: [values: CustomerFormValues] }>()

const values = reactive<CustomerFormValues>({ ...props.initial })
const touched = ref(false)
const homonyms = ref<Customer[]>([])
/** Nome para o qual o aviso de homônimo já foi visto e aceito. */
const acceptedHomonymFor = ref<string | null>(null)
const checking = ref(false)
const referenceField = useTemplateRef<HTMLElement>('referenceField')

const errors = computed(() => (touched.value ? validateCustomerForm(values) : {}))
/** Telefone ou CPF repetido (RN-06.02) aparece no próprio campo. */
const serverField = computed(() => customerErrorField(props.error?.code))
function fieldError(field: keyof CustomerFormValues): string {
  if (errors.value[field]) return errors.value[field] ?? ''
  if (serverField.value === field) return props.error?.hint ?? props.error?.message ?? ''
  return ''
}

watch(
  () => [values.name, values.phone, values.cpf, values.reference],
  () => {
    homonyms.value = []
  },
)

async function submit() {
  touched.value = true
  if (hasErrors(validateCustomerForm(values)) || props.busy || checking.value) return
  const name = values.name.trim()
  if (props.findSameName && acceptedHomonymFor.value !== name) {
    checking.value = true
    try {
      const found = await props.findSameName(name).catch(() => [])
      homonyms.value = homonymsWithoutIdentification(values, found) as Customer[]
    } finally {
      checking.value = false
    }
    if (homonyms.value.length > 0) {
      acceptedHomonymFor.value = name
      return
    }
  }
  emit('submit', { ...values })
}

function fillReference() {
  homonyms.value = []
  acceptedHomonymFor.value = null
  referenceField.value?.querySelector('input')?.focus()
}
</script>

<template>
  <form class="flex flex-col gap-3" novalidate data-testid="customer-form" @submit.prevent="submit">
    <AppTextField
      v-model="values.name"
      label="Nome"
      :maxlength="CUSTOMER_NAME_MAX"
      autocapitalize="words"
      autocomplete="off"
      :error="fieldError('name')"
      required
    />
    <AppTextField
      v-model="values.phone"
      label="Telefone (opcional)"
      hint="Com DDD."
      inputmode="numeric"
      autocomplete="off"
      :error="fieldError('phone')"
    />
    <AppTextField
      v-model="values.cpf"
      label="CPF (opcional)"
      inputmode="numeric"
      autocomplete="off"
      :error="fieldError('cpf')"
    />
    <div ref="referenceField">
      <AppTextField
        v-model="values.reference"
        label="Referência (opcional)"
        hint='Ex.: "apto 42, bloco B", "barraca do lado".'
        :maxlength="CUSTOMER_REFERENCE_MAX"
        autocomplete="off"
        :error="fieldError('reference')"
      />
    </div>
    <AppTextField
      v-model="values.note"
      label="Observação (opcional)"
      hint='Ex.: "filho da dona Maria".'
      :maxlength="CUSTOMER_NOTE_MAX"
      autocomplete="off"
      :error="fieldError('note')"
    />

    <AppAlert v-if="homonyms.length > 0" data-testid="homonym-warning">
      <p class="font-bold">
        Já existe cliente com o nome "{{ values.name.trim() }}". Preencha a referência (ou o
        telefone) para não confundir os dois.
      </p>
      <ul class="mt-1 list-disc pl-5 text-sm">
        <li v-for="customer in homonyms" :key="customer.id">
          {{ customer.name
          }}<template v-if="identificationLine(customer)">
            · {{ identificationLine(customer) }}</template
          >
        </li>
      </ul>
      <div class="mt-2 flex flex-wrap gap-2">
        <AppButton variant="secondary" :block="false" @click="fillReference">
          Preencher referência
        </AppButton>
        <AppButton variant="secondary" :block="false" type="submit" data-testid="homonym-confirm">
          Cadastrar mesmo assim
        </AppButton>
      </div>
    </AppAlert>

    <ErrorAlert v-if="error && !serverField" :error="error" />
    <AppButton type="submit" :loading="busy || checking" data-testid="customer-submit">
      {{ submitLabel }}
    </AppButton>
  </form>
</template>
