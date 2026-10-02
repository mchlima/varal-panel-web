<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
import { priceListName, type UnitOperation } from '~/lib/operation'

/**
 * Troca da tabela vigente (spec 04, seção 8.4; RN-04.31 a RN-04.33): "Normal" ou uma das tabelas
 * ativas, cada uma com quantos produtos têm preço nela; a confirmação diz "Itens novos usarão
 * os preços de Evento". Durante um evento, a tabela é a do evento e a troca fica bloqueada
 * (RN-04.32): a folha explica isso em vez de mostrar as opções. Só abre para o dono e para quem
 * opera caixa (quem chama confere).
 */
const props = defineProps<{ unitId: string; operation: UnitOperation }>()
const open = defineModel<boolean>('open', { required: true })

const menu = useMenuStore()
const operations = useOperationStore()
const connection = useConnectionStore()
const chosen = ref<{ id: string | null; name: string } | null>(null)
const busy = ref(false)
const error = ref('')

watch(open, (value) => {
  if (!value) return
  chosen.value = null
  error.value = ''
  if (menu.unitId !== props.unitId || !menu.menu) void menu.load(props.unitId)
})

const currentId = computed(() => props.operation.currentPriceList?.id ?? null)
const options = computed(() => [
  { id: null as string | null, name: 'Normal', detail: 'Preço normal do cardápio' },
  ...(menu.unitId === props.unitId ? (menu.menu?.priceLists ?? []) : [])
    .filter((list) => list.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((list) => ({
      id: list.id as string | null,
      name: list.name,
      detail:
        list.productCount === 1
          ? '1 produto com preço nesta tabela'
          : `${list.productCount} produtos com preço nesta tabela`,
    })),
])

async function confirm() {
  if (!chosen.value) return
  if (!connection.online) {
    error.value = 'Sem conexão. A troca da tabela precisa de internet.'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const { $api } = useNuxtApp()
    const { data, error: failure } = await $api.PUT('/api/v1/units/{id}/current-price-list', {
      params: { path: { id: props.unitId } },
      body: { priceListId: chosen.value.id, version: props.operation.version },
    })
    if (!data) {
      error.value = apiErrorMessage(failure)
      void operations.load(props.unitId)
      return
    }
    operations.apply(data, { fromRest: true })
    // Os preços dos botões do balcão são os da tabela efetiva (RN-04.33).
    if (menu.unitId === props.unitId) void menu.reload()
    open.value = false
  } catch (cause) {
    error.value = apiErrorMessage(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppDialog v-model:open="open" title="Tabela de preço">
    <div class="flex flex-col gap-4">
      <template v-if="operation.eventInProgress">
        <AppAlert>
          <p class="font-bold">Durante o evento, os preços são os do evento.</p>
          <p>
            O evento {{ operation.eventInProgress.contractorName }} está em andamento e usa a tabela
            {{ priceListName(operation.eventInProgress.priceList) }}. A troca fica liberada quando o
            evento for encerrado.
          </p>
        </AppAlert>
      </template>

      <template v-else-if="!chosen">
        <p class="text-text-muted">
          Escolha os preços que valem para os próximos pedidos. Os pedidos já enviados não mudam.
        </p>
        <p v-if="menu.loading && options.length === 1" class="text-text-muted">Carregando…</p>
        <ul class="flex flex-col gap-2">
          <li v-for="option in options" :key="option.id ?? 'normal'">
            <button
              type="button"
              class="flex min-h-16 w-full items-center gap-3 rounded-card border-2 px-4 py-2 text-left"
              :class="
                option.id === currentId
                  ? 'border-primary bg-primary-soft text-primary-deep'
                  : 'border-border-strong bg-surface text-text hover:border-primary'
              "
              :aria-current="option.id === currentId ? 'true' : undefined"
              :data-testid="`price-list-option-${option.name}`"
              @click="option.id === currentId ? (open = false) : (chosen = option)"
            >
              <AppIcon name="tag" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-lg font-bold">{{ option.name }}</span>
                <span class="text-sm">{{ option.detail }}</span>
              </span>
              <span
                v-if="option.id === currentId"
                class="flex items-center gap-1 text-sm font-bold"
              >
                <AppIcon name="check" :size="16" />
                Vigente
              </span>
            </button>
          </li>
        </ul>
        <p v-if="options.length === 1 && !menu.loading" class="text-sm text-text-muted">
          Nenhuma tabela de preço cadastrada. O dono cria tabelas (ex.: "Evento") em Cardápio →
          Tabelas de preço.
        </p>
      </template>

      <template v-else>
        <p class="text-lg">
          Itens novos usarão os preços de <strong>{{ chosen.name }}</strong
          >.
        </p>
        <p class="text-text-muted">
          Os pedidos já enviados continuam com o preço de quando saíram.
        </p>
        <AppAlert v-if="error" tone="error">{{ error }}</AppAlert>
        <AppButton :loading="busy" data-testid="confirm-price-list" @click="confirm">
          Usar {{ chosen.name }}
        </AppButton>
        <AppButton variant="ghost" @click="chosen = null">Escolher outra</AppButton>
      </template>
    </div>
  </AppDialog>
</template>
