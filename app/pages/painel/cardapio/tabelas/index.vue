<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
import type { PriceList } from '~/lib/operation'
import { PRICE_LIST_NAME_MAX, priceListNameError, productCountLabel } from '~/lib/price-lists'

/**
 * Tabelas de preço (`/painel/cardapio/tabelas`, spec 03, seção 5.3 e seção 9): lista com quantos
 * produtos têm preço em cada uma e qual está vigente; criar, renomear, desativar e reativar.
 * "Normal" é reservado (RN-03.20, CA-03.10); a vigente e a de um evento agendado ou em andamento
 * não são desativadas (RN-03.23, `PRICE_LIST_IN_USE`). Só o dono; só com conexão.
 */
useHead({ title: 'Tabelas de preço · Varal' })

const { $api } = useNuxtApp()
const { unitId } = usePanelUnit()
const action = useApiAction()
const idempotency = useIdempotencyKey()

const lists = ref<PriceList[]>([])
const loaded = ref(false)
const loadError = ref('')

const sorted = computed(() =>
  [...lists.value].sort((a, b) => Number(b.active) - Number(a.active) || a.sortOrder - b.sortOrder),
)

async function load() {
  const id = unitId.value
  if (!id) return
  try {
    const { data, error } = await $api.GET('/api/v1/units/{id}/price-lists', {
      params: { path: { id } },
    })
    if (!data) {
      loadError.value = apiErrorMessage(error)
      return
    }
    loadError.value = ''
    lists.value = data.data
    loaded.value = true
  } catch (error) {
    loadError.value = apiErrorMessage(error)
  }
}
watch(unitId, load, { immediate: true })
useRealtimeResync(load)
useRealtimeEvent('menu.updated', (event) => {
  if (event.data.unitId === unitId.value) void load()
})
useRealtimeEvent('unit.operation_updated', (event) => {
  // A tabela vigente mudou (RN-04.31): o selo "Valendo agora" acompanha.
  if (event.unitId === unitId.value) void load()
})

// Nova tabela
const creating = ref(false)
const newName = ref('')
const newNameError = ref('')

async function create() {
  const id = unitId.value
  if (!id) return
  newNameError.value = priceListNameError(newName.value, lists.value) ?? ''
  if (newNameError.value) return
  const body = { name: newName.value.trim().replace(/\s+/g, ' ') }
  const result = await action.run(() =>
    $api.POST('/api/v1/units/{id}/price-lists', {
      params: { path: { id }, header: { 'Idempotency-Key': idempotency.keyFor(body) } },
      body,
    }),
  )
  if (result.ok && result.data) {
    idempotency.reset()
    newName.value = ''
    creating.value = false
    await navigateTo(`/painel/cardapio/tabelas/${result.data.id}`)
  }
}

// Renomear
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameError = ref('')

function startRename(list: PriceList) {
  renamingId.value = list.id
  renameValue.value = list.name
  renameError.value = ''
  action.clear()
}

async function rename(list: PriceList) {
  renameError.value = priceListNameError(renameValue.value, lists.value, list.id) ?? ''
  if (renameError.value) return
  const result = await action.run(() =>
    $api.PATCH('/api/v1/price-lists/{id}', {
      params: { path: { id: list.id } },
      body: { name: renameValue.value.trim().replace(/\s+/g, ' '), version: list.version },
    }),
  )
  if (result.ok) {
    renamingId.value = null
    await load()
  }
}

async function setActive(list: PriceList, active: boolean) {
  renamingId.value = null
  const result = await action.run(() =>
    $api.PATCH('/api/v1/price-lists/{id}', {
      params: { path: { id: list.id } },
      body: { active, version: list.version },
    }),
  )
  if (result.ok) await load()
}
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <NuxtLink
        to="/painel/cardapio"
        class="inline-flex min-h-12 items-center gap-1 self-start font-bold text-primary-deep"
      >
        <AppIcon name="arrow-left" />
        Cardápio
      </NuxtLink>
      <h1 class="text-2xl">Tabelas de preço</h1>
      <p class="text-text-muted">
        Preencha uma vez os preços de um evento, festa ou delivery. Na hora, basta escolher qual
        tabela vale, no início do painel ou no balcão. Produto sem preço na tabela usa o preço
        normal.
      </p>
    </div>
    <UnitPicker />

    <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
    <p v-else-if="!loaded" class="text-text-muted">Carregando tabelas…</p>

    <template v-else>
      <ErrorAlert :error="action.error.value" @reload="load" />

      <form
        v-if="creating"
        class="flex flex-col gap-3 rounded-card border-2 border-border bg-surface p-4"
        novalidate
        aria-label="Nova tabela de preço"
        @submit.prevent="create"
      >
        <AppTextField
          v-model="newName"
          label="Nome da tabela"
          hint="Ex.: Evento, Casamento, Delivery."
          :maxlength="PRICE_LIST_NAME_MAX"
          :error="newNameError"
        />
        <div class="flex flex-wrap gap-2">
          <AppButton type="submit" :block="false" :loading="action.busy.value">
            Criar e preencher preços
          </AppButton>
          <AppButton variant="ghost" :block="false" @click="creating = false">Cancelar</AppButton>
        </div>
      </form>
      <AppButton v-else data-testid="new-price-list" @click="((creating = true), action.clear())">
        <AppIcon name="plus" />
        Nova tabela
      </AppButton>

      <AppAlert v-if="lists.length === 0">
        <p class="font-bold">Nenhuma tabela ainda.</p>
        <p>
          Hoje vale só o preço normal do cardápio. Crie uma tabela, como "Evento", se em algum dia
          você cobra preços diferentes.
        </p>
      </AppAlert>

      <ul class="flex flex-col gap-3">
        <li
          v-for="list in sorted"
          :key="list.id"
          class="flex flex-col gap-3 rounded-card border-2 bg-surface p-4"
          :class="list.current ? 'border-primary' : 'border-border'"
          data-testid="price-list"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="flex min-w-0 flex-1 flex-col">
              <span
                class="font-display text-lg font-semibold"
                :class="list.active ? '' : 'text-text-muted'"
                >{{ list.name }}</span
              >
              <span class="text-sm text-text-muted">{{
                productCountLabel(list.productCount)
              }}</span>
            </span>
            <StatusChip v-if="list.current" tone="info" label="Valendo agora" />
            <StatusChip v-if="!list.active" tone="inactive" label="Desativada" />
          </div>

          <form
            v-if="renamingId === list.id"
            class="flex flex-col gap-2"
            novalidate
            :aria-label="`Renomear ${list.name}`"
            @submit.prevent="rename(list)"
          >
            <AppTextField
              v-model="renameValue"
              label="Novo nome"
              :maxlength="PRICE_LIST_NAME_MAX"
              :error="renameError"
            />
            <div class="flex flex-wrap gap-2">
              <AppButton
                type="submit"
                variant="secondary"
                :block="false"
                :loading="action.busy.value"
              >
                Salvar nome
              </AppButton>
              <AppButton variant="ghost" :block="false" @click="renamingId = null">
                Cancelar
              </AppButton>
            </div>
          </form>

          <div v-else class="flex flex-wrap gap-2">
            <AppButton
              v-if="list.active"
              variant="secondary"
              :block="false"
              :to="`/painel/cardapio/tabelas/${list.id}`"
            >
              <AppIcon name="tag" />
              Preços
            </AppButton>
            <AppButton variant="ghost" :block="false" class="px-2" @click="startRename(list)">
              <AppIcon name="edit" />
              Renomear
            </AppButton>
            <AppButton
              v-if="list.active"
              variant="ghost"
              :block="false"
              class="px-2"
              :disabled="action.busy.value"
              @click="setActive(list, false)"
            >
              <AppIcon name="power" />
              Desativar
            </AppButton>
            <AppButton
              v-else
              variant="ghost"
              :block="false"
              class="px-2"
              :disabled="action.busy.value"
              @click="setActive(list, true)"
            >
              <AppIcon name="power" />
              Reativar
            </AppButton>
          </div>
        </li>
      </ul>
    </template>
  </PanelShell>
</template>
