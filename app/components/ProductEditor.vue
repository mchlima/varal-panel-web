<script setup lang="ts">
import { centsToInput, parseReais } from '~/lib/money'

/**
 * Editor de produto (spec 03, seção 5): nome, descrição curta (até 120), preço digitado em
 * reais e guardado em centavos (RN-03.09: ≥ 0), categoria, estação de preparo própria
 * (opcional, RN-03.08), ativo, esgotado (RN-03.11) e grupos de modificadores. Mudar preço ou
 * modificadores com turno aberto vale para pedidos novos (RN-03.12).
 */
const props = defineProps<{ unitId: string; productId: string | null; categoryId: string }>()
const emit = defineEmits<{ created: [id: string]; close: [] }>()

const { $api } = useNuxtApp()
const menu = useMenuStore()
const action = useApiAction()
const idempotency = useIdempotencyKey()

const product = computed(() => (props.productId ? menu.findProduct(props.productId) : null))

const form = reactive({
  name: '',
  description: '',
  price: '',
  categoryId: props.categoryId,
  stationId: '',
  active: true,
})
const errors = ref<{ name?: string; price?: string; description?: string }>({})
const addingGroup = ref(false)

function fill() {
  const current = product.value
  form.name = current?.name ?? ''
  form.description = current?.description ?? ''
  form.price = current ? centsToInput(current.priceCents) : ''
  form.categoryId = current?.categoryId ?? props.categoryId
  form.stationId = current?.stationId ?? ''
  form.active = current?.active ?? true
}
fill()

const categoryOptions = computed(() =>
  menu.categories.map((category) => ({ value: category.id, label: category.name })),
)
const categoryStation = computed(() => {
  const category = menu.categories.find((item) => item.id === form.categoryId)
  return menu.stationName(category?.defaultStationId)
})
const stationOptions = computed(() => {
  const options = [
    { value: '', label: `Usar a da categoria (${categoryStation.value})` },
    ...menu.queueStations.map((station) => ({ value: station.id, label: station.name })),
  ]
  if (form.stationId && !options.some((option) => option.value === form.stationId)) {
    options.push({ value: form.stationId, label: `${menu.stationName(form.stationId)} (inativa)` })
  }
  return options
})

async function save() {
  errors.value = {}
  const cents = parseReais(form.price)
  if (!form.name.trim()) errors.value.name = 'Informe o nome do produto.'
  if (cents === null) errors.value.price = 'Informe o preço em reais (ex.: 12,50).'
  if (form.description.length > 120) errors.value.description = 'Use até 120 caracteres.'
  if (Object.keys(errors.value).length || cents === null) return

  const base = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    priceCents: cents,
    categoryId: form.categoryId,
    stationId: form.stationId || null,
    active: form.active,
  }
  const current = product.value
  if (current) {
    const result = await action.run(() =>
      $api.PATCH('/api/v1/products/{id}', {
        params: { path: { id: current.id } },
        body: { ...base, version: current.version },
      }),
    )
    if (result.ok) await menu.reload()
    return
  }
  const result = await action.run(() =>
    $api.POST('/api/v1/products', {
      params: { header: { 'Idempotency-Key': idempotency.keyFor(base) } },
      body: base,
    }),
  )
  if (result.ok && result.data) {
    idempotency.reset()
    await menu.reload()
    emit('created', result.data.id)
  }
}

async function reloadAndFill() {
  await menu.reload()
  fill()
  action.clear()
}

async function groupsChanged() {
  addingGroup.value = false
  await menu.reload()
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <form
      class="flex flex-col gap-4"
      novalidate
      aria-label="Dados do produto"
      @submit.prevent="save"
    >
      <AppTextField v-model="form.name" label="Nome" :error="errors.name" :maxlength="80" />
      <AppTextField
        v-model="form.description"
        label="Descrição curta (opcional)"
        :hint="`${form.description.length} de 120 caracteres.`"
        :error="errors.description"
        :maxlength="120"
      />
      <AppTextField
        v-model="form.price"
        label="Preço"
        prefix="R$"
        inputmode="decimal"
        placeholder="0,00"
        :error="errors.price"
      />
      <AppSelect v-model="form.categoryId" label="Categoria" :options="categoryOptions" />
      <AppSelect
        v-model="form.stationId"
        label="Estação de preparo"
        hint="Onde o produto é preparado. Sem estação própria, vale a da categoria."
        :options="stationOptions"
      />
      <AppCheckbox
        v-model="form.active"
        label="Ativo"
        description="Produto inativo não aparece no balcão."
      />
      <ErrorAlert :error="action.error.value" @reload="reloadAndFill" />
      <AppButton type="submit" :loading="action.busy.value">
        {{ product ? 'Salvar produto' : 'Criar produto' }}
      </AppButton>
    </form>

    <section v-if="product" class="flex flex-col gap-3" aria-labelledby="sold-out-heading">
      <h3 id="sold-out-heading" class="text-lg">Esgotado</h3>
      <div class="flex items-center gap-3 rounded-card border border-border bg-surface p-3">
        <p class="min-w-0 flex-1 text-sm text-text-muted">
          Esgotado aparece bloqueado no balcão. A equipe também marca pelas estações.
        </p>
        <SoldOutToggle :product="product" />
      </div>
    </section>

    <section v-if="product" class="flex flex-col gap-3" aria-labelledby="groups-heading">
      <div class="flex flex-col gap-1">
        <h3 id="groups-heading" class="text-lg">Modificadores</h3>
        <p class="text-sm text-text-muted">
          Escolhas do cliente, como ponto da carne ou acompanhamentos. Com mínimo 1 ou mais, o
          balcão só envia o item depois da escolha.
        </p>
      </div>
      <ModifierGroupEditor
        v-for="group in product.modifierGroups"
        :key="group.id"
        :group="group"
        @changed="menu.reload"
      />
      <NewModifierGroupForm
        v-if="addingGroup"
        :product-id="product.id"
        @saved="groupsChanged"
        @cancel="addingGroup = false"
      />
      <AppButton v-else variant="secondary" @click="addingGroup = true">
        <AppIcon name="plus" />
        Novo grupo de modificadores
      </AppButton>
    </section>
    <AppAlert v-else>Salve o produto para adicionar modificadores.</AppAlert>
  </div>
</template>
