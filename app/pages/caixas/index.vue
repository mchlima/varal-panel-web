<script setup lang="ts">
import { formatCents, parseReais } from '~/lib/money'
import type { QueueOutcome } from '~/lib/offline-queue'
import { pendingLabel, pendingOperations } from '~/lib/operation-actions'
import {
  CASH_MOVEMENT_LABELS,
  REASON_MAX,
  expectedOf,
  registerState,
  type CashMovementType,
  type CashRegister,
  type CashRegisterSession,
} from '~/lib/payment'

/**
 * Caixas da unidade (`/caixas`, spec 05, seções 5 e 8): para o dono e quem opera caixa
 * (RN-05.16). Um cartão por caixa cadastrado: fechado, com "Abrir caixa"; aberto, com
 * responsável, esperado por forma (RN-05.19), sangria e suprimento (RN-05.18) e "Fechar caixa".
 * Com um único caixa, a tela vai direto ao essencial. Sangria e suprimento são operacionais e
 * vão pela fila local (spec 01, seção 11).
 */
useHead({ title: 'Caixa · Varal' })

const route = useRoute()
const session = useSessionStore()
const connection = useConnectionStore()
const operations = useOperations()
const panel = usePanelUnit()

/** Unidades em que esta pessoa opera caixa (RN-05.16). */
const units = computed(() =>
  panel.units.value.filter((unit) => session.isOwner || unit.canOperateCash),
)
const unitParam = typeof route.query.unidade === 'string' ? route.query.unidade : null
if (unitParam && units.value.some((unit) => unit.id === unitParam)) panel.select(unitParam)
const unit = computed(
  () => units.value.find((item) => item.id === panel.unitId.value) ?? units.value[0] ?? null,
)
const unitId = computed(() => unit.value?.id ?? null)
/** Veio do balcão sem caixa aberto: depois de abrir, volta ao balcão (spec 05, seção 8). */
const back = computed(() => (route.query.volta === 'balcao' ? 'balcao' : null))

const cash = useCashRegisters(unitId)
const registers = computed(() => cash.registers.value)
const single = computed(() => registers.value.length === 1)

/**
 * Uma ação principal (spec 08, CA-08.02): com um único caixa, o botão dele; com vários, só o
 * primeiro esquecido aberto de um dia anterior (RN-05.26) fica em destaque.
 */
const primaryId = computed(() => {
  if (single.value) {
    const only = registers.value[0]!
    return registerState(only) !== 'open' || only.session?.openSinceEarlierDay ? only.id : null
  }
  return (
    registers.value.find(
      (item) => item.session?.status === 'open' && item.session.openSinceEarlierDay,
    )?.id ?? null
  )
})

// Sangria e suprimento (RN-05.18)
const movement = ref<{
  register: CashRegister
  session: CashRegisterSession
  type: CashMovementType
} | null>(null)
const movementOpen = computed({
  get: () => movement.value !== null,
  set: (open: boolean) => {
    if (!open) movement.value = null
  },
})
const amountInput = ref('')
const reasonInput = ref('')
const movementTouched = ref(false)
const movementBusy = ref(false)
const movementError = ref('')
const notice = ref('')
const amountError = computed(() => {
  if (!movementTouched.value) return ''
  const cents = parseReais(amountInput.value)
  if (cents === null || cents <= 0) return 'Informe um valor maior que zero.'
  const target = movement.value
  if (target?.type === 'withdrawal' && cents > expectedOf(target.session, 'cash')) {
    return `A sangria não pode passar do dinheiro esperado na gaveta (${formatCents(expectedOf(target.session, 'cash'))}).`
  }
  return ''
})
const reasonError = computed(() =>
  movementTouched.value && !reasonInput.value.trim() ? 'Diga o motivo.' : '',
)

function startMovement(register: CashRegister, type: CashMovementType) {
  if (register.session?.status !== 'open') return
  movement.value = { register, session: register.session, type }
  amountInput.value = ''
  reasonInput.value = ''
  movementTouched.value = false
  movementError.value = ''
}

/** Recusas explicadas no diálogo (resposta dentro da espera) não se repetem no topo. */
const explainedInline = new Set<string>()
const waitingKey = ref<string | null>(null)
const WAIT_MS = 2_500

async function submitMovement() {
  movementTouched.value = true
  const target = movement.value
  if (!target || amountError.value || reasonError.value || movementBusy.value) return
  const amountCents = parseReais(amountInput.value) ?? 0
  movementBusy.value = true
  movementError.value = ''
  try {
    const { idempotencyKey, settled } = await operations.submit({
      path: `/api/v1/cash-register-sessions/${target.session.id}/movements`,
      body: { type: target.type, amountCents, reason: reasonInput.value.trim() },
      label: `${CASH_MOVEMENT_LABELS[target.type]} de ${formatCents(amountCents)} no ${target.register.name}`,
      meta: {
        kind: 'cash.movement',
        cashRegisterId: target.register.id,
        sessionId: target.session.id,
        type: target.type,
        amountCents,
      },
    })
    waitingKey.value = idempotencyKey
    const outcome: QueueOutcome | null = connection.online
      ? await Promise.race([
          settled,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS)),
        ])
      : null
    if (outcome && !outcome.ok) {
      explainedInline.add(idempotencyKey)
      movementError.value = outcome.error.message
      return
    }
    movement.value = null
  } finally {
    waitingKey.value = null
    movementBusy.value = false
  }
}

// A resposta é a abertura; o caixa com a versão nova chega pelo `cash_register.updated` e pela
// recarga abaixo (o REST é a fonte da verdade, RN-01.05).
operations.onSettled((meta) => {
  if (meta.kind === 'cash.movement') void cash.load()
})
useOperationFailures((meta, failure, action) => {
  if (meta.kind !== 'cash.movement') return false
  const key = action.idempotencyKey
  if (explainedInline.has(key) || waitingKey.value === key) return true
  notice.value = `${CASH_MOVEMENT_LABELS[meta.type]} de ${formatCents(meta.amountCents)} não registrada: ${failure.message}`
  return true
})

const pendingMovements = computed(() => {
  const result: Record<string, string[]> = {}
  for (const op of pendingOperations(connection.pending, (meta) => meta.kind === 'cash.movement')) {
    if (op.meta.kind !== 'cash.movement') continue
    const text = `${CASH_MOVEMENT_LABELS[op.meta.type]} ${formatCents(op.meta.amountCents)}: ${pendingLabel(op.action, connection.online)}`
    result[op.meta.cashRegisterId] = [...(result[op.meta.cashRegisterId] ?? []), text]
  }
  return result
})
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl">Caixa</h1>
      <p class="text-text-muted">
        Abrir o caixa começa o dia e libera o balcão para vender. Fechar o caixa termina: você
        confere o dinheiro, o Pix e as maquininhas.
      </p>
    </div>

    <AppAlert v-if="units.length === 0" tone="error">
      Só o dono e quem opera o caixa abrem, movimentam e fecham caixa.
    </AppAlert>
    <template v-else>
      <div v-if="units.length > 1" role="group" aria-label="Unidade" class="flex flex-wrap gap-2">
        <button
          v-for="item in units"
          :key="item.id"
          type="button"
          :aria-pressed="item.id === unit?.id"
          class="min-h-12 rounded-button border-2 px-4 font-bold"
          :class="
            item.id === unit?.id
              ? 'border-primary bg-primary-soft text-primary-deep'
              : 'border-border-strong bg-surface'
          "
          @click="panel.select(item.id)"
        >
          {{ item.name }}
        </button>
      </div>

      <AppAlert v-if="cash.error.value" tone="error">{{ cash.error.value }}</AppAlert>
      <AppAlert v-if="notice" tone="error">
        <p>{{ notice }}</p>
        <button type="button" class="min-h-12 font-bold underline" @click="notice = ''">
          Entendi
        </button>
      </AppAlert>

      <p v-if="!cash.loaded.value && !cash.error.value" class="text-text-muted">Carregando…</p>
      <AppAlert v-else-if="cash.loaded.value && registers.length === 0">
        <p class="font-bold">Nenhum caixa cadastrado em {{ unit?.name }}.</p>
        <p v-if="session.isOwner">Cadastre o primeiro caixa para poder vender.</p>
        <p v-else>Peça para o dono cadastrar um caixa.</p>
      </AppAlert>

      <ul
        class="grid grid-cols-1 gap-3"
        :class="single ? 'max-w-xl' : 'lg:grid-cols-2'"
        data-testid="registers"
      >
        <li v-for="register in registers" :key="register.id">
          <CashRegisterCard
            :register="register"
            :primary="register.id === primaryId"
            :back="back"
            :pending="pendingMovements[register.id]"
            @movement="startMovement(register, $event)"
          />
        </li>
      </ul>

      <NuxtLink
        v-if="session.isOwner && unit"
        :to="`/painel/unidades/${unit.id}/caixas`"
        class="inline-flex min-h-12 items-center gap-2 self-start font-bold text-primary-deep underline-offset-4 hover:underline"
        data-testid="manage-registers"
      >
        <AppIcon name="edit" />
        Cadastrar, renomear ou desativar caixas
      </NuxtLink>
    </template>

    <AppDialog
      v-model:open="movementOpen"
      :title="movement ? `${CASH_MOVEMENT_LABELS[movement.type]} · ${movement.register.name}` : ''"
    >
      <form
        v-if="movement"
        class="flex flex-col gap-4"
        novalidate
        data-testid="movement-form"
        @submit.prevent="submitMovement"
      >
        <p class="text-text-muted">
          {{
            movement.type === 'withdrawal'
              ? 'Dinheiro retirado da gaveta (ex.: levar para o cofre).'
              : 'Dinheiro colocado na gaveta (ex.: reforço de troco).'
          }}
          Dinheiro esperado agora: {{ formatCents(expectedOf(movement.session, 'cash')) }}.
        </p>
        <AppTextField
          v-model="amountInput"
          label="Valor"
          inputmode="decimal"
          prefix="R$"
          :error="amountError"
          autocomplete="off"
        />
        <AppTextField
          v-model="reasonInput"
          label="Motivo"
          :maxlength="REASON_MAX"
          :error="reasonError"
          autocomplete="off"
        />
        <AppAlert v-if="movementError" tone="error">{{ movementError }}</AppAlert>
        <AppButton type="submit" :loading="movementBusy" data-testid="submit-movement">
          Registrar {{ CASH_MOVEMENT_LABELS[movement.type].toLowerCase() }}
        </AppButton>
      </form>
    </AppDialog>
  </PanelShell>
</template>
