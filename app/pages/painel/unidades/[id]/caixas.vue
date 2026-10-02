<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
import {
  REGISTER_NAME_MAX,
  REGISTER_STATE_LABELS,
  cashRegisterHint,
  registerState,
  type CashRegister,
} from '~/lib/payment'
import type { ExplainedError } from '~/lib/setup'

/**
 * Caixas cadastrados da unidade (`/painel/unidades/{id}/caixas`, spec 05, seção 5.1): só o
 * dono. Lista com nome, situação e ordem; criar, renomear, ordenar, desativar e ativar
 * (RN-05.17, RN-05.27). A API recusa desativar o caixa aberto (`CASH_REGISTER_OPEN`) e o último
 * ativo (`LAST_ACTIVE_CASH_REGISTER`, CA-05.14), e nome repetido (`CASH_REGISTER_NAME_TAKEN`).
 * Caixas nunca são apagados: as aberturas passadas apontam para eles.
 */
const route = useRoute()
const { $api } = useNuxtApp()
const session = useSessionStore()
const unitId = computed(() => String(route.params.id))
const unit = computed(() => session.me?.units.find((item) => item.id === unitId.value) ?? null)

useHead({ title: () => `${unit.value?.name ?? 'Unidade'} · Caixas · Varal` })

const registers = ref<CashRegister[]>([])
const loaded = ref(false)
const loadError = ref('')

async function load() {
  loadError.value = ''
  try {
    const { data, error } = await $api.GET('/api/v1/units/{id}/cash-registers', {
      params: { path: { id: unitId.value } },
    })
    if (!data) {
      loadError.value = apiErrorMessage(error)
      return
    }
    registers.value = [...data.data].sort((a, b) => a.sortOrder - b.sortOrder)
    loaded.value = true
  } catch (error) {
    loadError.value = apiErrorMessage(error)
  }
}
watch(unitId, load, { immediate: true })
useRealtimeResync(load)
for (const name of [
  'cash_register.opened',
  'cash_register.updated',
  'cash_register.closed',
] as const) {
  useRealtimeEvent(name, (event) => {
    if (event.unitId === unitId.value) void load()
  })
}

const action = useApiAction()
const failure = computed<ExplainedError | null>(() => {
  const error = action.error.value
  return error ? { ...error, hint: cashRegisterHint(error.code) ?? error.hint } : null
})

// Novo caixa
const idempotency = useIdempotencyKey()
const newName = ref('')
const newError = ref('')
async function create() {
  const name = newName.value.trim().replace(/\s+/g, ' ')
  newError.value = ''
  if (!name) newError.value = 'Dê um nome ao caixa (ex.: Caixa 2).'
  else if (name.length > REGISTER_NAME_MAX)
    newError.value = `Use até ${REGISTER_NAME_MAX} caracteres.`
  if (newError.value) return
  const body = { name }
  const result = await action.run(() =>
    $api.POST('/api/v1/units/{id}/cash-registers', {
      params: {
        path: { id: unitId.value },
        header: { 'Idempotency-Key': idempotency.keyFor(body) },
      },
      body,
    }),
  )
  if (result.ok) {
    idempotency.reset()
    newName.value = ''
    await load()
  }
}

// Renomear
const editingId = ref<string | null>(null)
const editName = ref('')
const editError = ref('')
function startEdit(register: CashRegister) {
  editingId.value = register.id
  editName.value = register.name
  editError.value = ''
  action.clear()
}

async function patch(
  register: CashRegister,
  body: { name?: string; active?: boolean; sortOrder?: number },
): Promise<boolean> {
  const result = await action.run(() =>
    $api.PATCH('/api/v1/cash-registers/{id}', {
      params: { path: { id: register.id } },
      body: { ...body, version: register.version },
    }),
  )
  await load()
  return result.ok
}

async function saveName(register: CashRegister) {
  const name = editName.value.trim().replace(/\s+/g, ' ')
  editError.value = ''
  if (!name) editError.value = 'Dê um nome ao caixa.'
  else if (name.length > REGISTER_NAME_MAX)
    editError.value = `Use até ${REGISTER_NAME_MAX} caracteres.`
  if (editError.value) return
  if (await patch(register, { name })) editingId.value = null
}

/** Troca a posição com o vizinho (ordem da tela de caixas e da escolha no Receber). */
async function move(index: number, delta: -1 | 1) {
  const target = registers.value[index + delta]
  const current = registers.value[index]
  if (!target || !current) return
  await patch(current, { sortOrder: target.sortOrder })
}
</script>

<template>
  <PanelShell>
    <NuxtLink
      to="/painel/unidades"
      class="inline-flex min-h-12 items-center gap-2 self-start font-bold text-primary-deep"
    >
      <AppIcon name="arrow-left" />
      Unidades
    </NuxtLink>
    <div class="flex flex-col gap-1">
      <p class="text-text-muted">{{ unit?.name }}</p>
      <h1 class="text-2xl">Caixas da unidade</h1>
      <p class="text-text-muted">
        Cada caixa é uma gaveta com dinheiro, Pix e maquininha própria. A maioria das barracas usa
        um só. Abrir e fechar o caixa é feito em
        <NuxtLink :to="`/caixas?unidade=${unitId}`" class="font-bold text-primary-deep underline"
          >Caixa</NuxtLink
        >.
      </p>
    </div>

    <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
    <p v-else-if="!loaded" class="text-text-muted">Carregando…</p>
    <template v-else>
      <ErrorAlert :error="failure" @reload="load" />
      <ul class="flex max-w-2xl flex-col gap-2" data-testid="register-list">
        <li
          v-for="(register, index) in registers"
          :key="register.id"
          class="flex flex-col gap-2 rounded-card border-2 border-border bg-surface p-3"
          data-testid="register-row"
          :data-register-name="register.name"
        >
          <form
            v-if="editingId === register.id"
            class="flex flex-col gap-2"
            novalidate
            @submit.prevent="saveName(register)"
          >
            <AppTextField
              v-model="editName"
              label="Nome do caixa"
              :maxlength="REGISTER_NAME_MAX"
              :error="editError"
              autocomplete="off"
            />
            <div class="flex flex-wrap gap-2">
              <AppButton
                type="submit"
                variant="secondary"
                :block="false"
                :loading="action.busy.value"
              >
                Salvar
              </AppButton>
              <AppButton variant="ghost" :block="false" @click="editingId = null"
                >Cancelar</AppButton
              >
            </div>
          </form>
          <template v-else>
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-lg font-bold">{{ register.name }}</span>
              <StatusChip
                :tone="
                  registerState(register) === 'open'
                    ? 'active'
                    : registerState(register) === 'inactive'
                      ? 'inactive'
                      : 'info'
                "
                :label="REGISTER_STATE_LABELS[registerState(register)]"
              />
            </div>
            <div class="flex flex-wrap items-center gap-1">
              <button
                type="button"
                class="flex size-12 items-center justify-center rounded-button text-primary-deep hover:bg-primary-soft disabled:opacity-40"
                :disabled="index === 0 || action.busy.value"
                :aria-label="`Subir ${register.name}`"
                @click="move(index, -1)"
              >
                <AppIcon name="arrow-up" />
              </button>
              <button
                type="button"
                class="flex size-12 items-center justify-center rounded-button text-primary-deep hover:bg-primary-soft disabled:opacity-40"
                :disabled="index === registers.length - 1 || action.busy.value"
                :aria-label="`Descer ${register.name}`"
                @click="move(index, 1)"
              >
                <AppIcon name="arrow-down" />
              </button>
              <AppButton variant="ghost" :block="false" @click="startEdit(register)">
                <AppIcon name="edit" />
                Renomear
              </AppButton>
              <ConfirmAction
                v-if="register.active"
                label="Desativar"
                :question="`Desativar ${register.name}?`"
                confirm-label="Desativar caixa"
                :loading="action.busy.value"
                @confirm="patch(register, { active: false })"
              >
                <template #icon><AppIcon name="power" /></template>
                <p>
                  Ele some da tela de caixas e não pode mais ser aberto. O histórico continua nos
                  relatórios, e dá para ativar de novo.
                </p>
              </ConfirmAction>
              <AppButton
                v-else
                variant="ghost"
                :block="false"
                :loading="action.busy.value"
                @click="patch(register, { active: true })"
              >
                <AppIcon name="power" />
                Ativar
              </AppButton>
            </div>
          </template>
        </li>
      </ul>

      <form
        class="flex max-w-2xl flex-col gap-3 rounded-card border-2 border-border bg-surface p-4"
        novalidate
        data-testid="new-register-form"
        @submit.prevent="create"
      >
        <h2 class="text-lg">Novo caixa</h2>
        <AppTextField
          v-model="newName"
          label="Nome do caixa"
          placeholder="Caixa 2, Balcão…"
          :maxlength="REGISTER_NAME_MAX"
          :error="newError"
          autocomplete="off"
        />
        <AppButton
          type="submit"
          variant="secondary"
          :loading="action.busy.value"
          data-testid="create-register"
        >
          <AppIcon name="plus" />
          Cadastrar caixa
        </AppButton>
      </form>
    </template>
  </PanelShell>
</template>
