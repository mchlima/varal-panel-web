<script setup lang="ts">
import OperationShell from '~/components/OperationShell.vue'
import PanelShell from '~/components/PanelShell.vue'
import { formatTime } from '~/lib/datetime'
import { formatCents, parseReais } from '~/lib/money'
import type { QueueOutcome } from '~/lib/offline-queue'
import type { Shift } from '~/lib/operation'
import { pendingLabel, pendingOperations } from '~/lib/operation-actions'
import {
  CASH_MOVEMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  REASON_MAX,
  REGISTER_NAME_MAX,
  actorLabel,
  differenceLabel,
  expectedOf,
  type CashMovementType,
  type CashRegister,
  type CashRegisterDetail,
} from '~/lib/payment'
import { explainError } from '~/lib/setup'

/**
 * Caixas do turno (`/caixas`, spec 05, seções 5 e 8): para o dono e quem opera caixa
 * (RN-05.16). Lista os caixas com responsável e esperado por forma (RN-05.19), abre caixa com
 * nome e troco inicial (RN-05.17), registra sangria e suprimento com motivo (RN-05.18) e leva ao
 * fechamento (`/caixas/{id}/fechar`). Abrir caixa é feito com conexão (como o turno); sangria e
 * suprimento são operacionais e vão pela fila local (spec 01, seção 11).
 */
useHead({ title: 'Caixas · Varal' })

const route = useRoute()
const session = useSessionStore()
const connection = useConnectionStore()
const operations = useOperations()
const { $api } = useNuxtApp()

/** Unidades em que esta pessoa opera caixa (RN-05.16). */
const units = computed(() =>
  (session.me?.units ?? []).filter((unit) => session.isOwner || unit.canOperateCash),
)
const selectedUnitId = ref<string | null>(
  typeof route.query.unidade === 'string' ? route.query.unidade : null,
)
const unit = computed(
  () => units.value.find((item) => item.id === selectedUnitId.value) ?? units.value[0] ?? null,
)
const unitId = computed(() => unit.value?.id ?? null)

const shift = ref<Shift | null>(null)
const shiftLoaded = ref(false)
const shiftError = ref('')
const shiftId = computed(() => shift.value?.id ?? null)
const cash = useCashRegisters(shiftId, unitId)

async function loadShift() {
  const id = unitId.value
  if (!id) return
  shiftError.value = ''
  try {
    const { data, error } = await $api.GET('/api/v1/units/{id}/shifts/current', {
      params: { path: { id } },
    })
    if (!data) {
      shiftError.value = explainError(error).message
      return
    }
    shift.value = data.shift
    shiftLoaded.value = true
  } catch (error) {
    shiftError.value = explainError(error).message
  }
}

watch(
  unitId,
  (id) => {
    shiftLoaded.value = false
    shift.value = null
    if (id) void loadShift()
  },
  { immediate: true },
)
useRealtimeResync(loadShift)
for (const event of ['shift.opened', 'shift.closed'] as const) {
  useRealtimeEvent(event, (payload) => {
    if (payload.unitId === unitId.value) void loadShift()
  })
}

/** Nomes dos colaboradores, para o responsável de cada caixa (o dono lê a equipe). */
const staffNames = ref<Record<string, string>>({})
onMounted(async () => {
  if (!session.isOwner) return
  try {
    const { data } = await $api.GET('/api/v1/staff')
    staffNames.value = Object.fromEntries(
      (data?.data ?? []).map((member) => [member.id, member.name]),
    )
  } catch {
    // Sem a lista, o responsável aparece como "Colaborador".
  }
})
const me = computed(() =>
  session.me ? { type: session.me.subject.type, id: session.me.subject.id } : null,
)
function responsible(register: CashRegister): string {
  return actorLabel(register.openedBy, me.value, staffNames.value)
}

// Abrir caixa (RN-05.17)
const openAction = useApiAction()
const openKey = useIdempotencyKey()
const openFormVisible = ref(false)
const nameInput = ref('')
const floatInput = ref('')
const openTouched = ref(false)
const floatError = computed(() => {
  if (!openTouched.value) return ''
  if (!floatInput.value.trim()) return 'Informe o troco inicial (pode ser 0).'
  return parseReais(floatInput.value) === null ? 'Valor inválido.' : ''
})
const nameError = computed(() =>
  openTouched.value && nameInput.value.trim().length > REGISTER_NAME_MAX
    ? `Use até ${REGISTER_NAME_MAX} caracteres.`
    : '',
)

async function openRegister() {
  const current = shift.value
  openTouched.value = true
  if (!current || floatError.value || nameError.value) return
  const name = nameInput.value.trim().replace(/\s+/g, ' ')
  const body = {
    openingFloatCents: parseReais(floatInput.value) ?? 0,
    ...(name ? { name } : {}),
  }
  const result = await openAction.run(() =>
    $api.POST('/api/v1/shifts/{id}/cash-registers', {
      params: { path: { id: current.id }, header: { 'Idempotency-Key': openKey.keyFor(body) } },
      body,
    }),
  )
  if (result.ok) {
    openKey.reset()
    if (result.data) cash.apply(result.data)
    nameInput.value = ''
    floatInput.value = ''
    openTouched.value = false
    openFormVisible.value = false
  }
}

// Sangria e suprimento (RN-05.18)
const movement = ref<{ register: CashRegister; type: CashMovementType } | null>(null)
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
  if (target?.type === 'withdrawal' && cents > expectedOf(target.register, 'cash')) {
    return `A sangria não pode passar do dinheiro esperado na gaveta (${formatCents(expectedOf(target.register, 'cash'))}).`
  }
  return ''
})
const reasonError = computed(() =>
  movementTouched.value && !reasonInput.value.trim() ? 'Diga o motivo.' : '',
)

function startMovement(register: CashRegister, type: CashMovementType) {
  movement.value = { register, type }
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
      path: `/api/v1/cash-registers/${target.register.id}/movements`,
      body: { type: target.type, amountCents, reason: reasonInput.value.trim() },
      label: `${CASH_MOVEMENT_LABELS[target.type]} de ${formatCents(amountCents)} no ${target.register.name}`,
      meta: {
        kind: 'cash.movement',
        cashRegisterId: target.register.id,
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

operations.onSettled((meta, outcome) => {
  if (meta.kind !== 'cash.movement') return
  if (outcome.ok) cash.apply(outcome.body as CashRegisterDetail)
  else void cash.load()
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

const isOwner = computed(() => session.isOwner)
</script>

<template>
  <component
    :is="isOwner ? PanelShell : OperationShell"
    v-bind="
      isOwner
        ? {}
        : { title: 'Caixas', unitName: unit?.name, back: '/balcao', backLabel: 'Voltar ao balcão' }
    "
  >
    <div v-if="isOwner" class="flex flex-col gap-1">
      <h1 class="text-2xl">Caixas</h1>
      <p class="text-text-muted">Abrir caixa, sangria, suprimento e fechamento do turno.</p>
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
          @click="selectedUnitId = item.id"
        >
          {{ item.name }}
        </button>
      </div>

      <AppAlert v-if="shiftError" tone="error">{{ shiftError }}</AppAlert>
      <AppAlert v-if="cash.error.value" tone="error">{{ cash.error.value }}</AppAlert>
      <AppAlert v-if="notice" tone="error">
        <p>{{ notice }}</p>
        <button type="button" class="min-h-12 font-bold underline" @click="notice = ''">
          Entendi
        </button>
      </AppAlert>
      <p v-if="!shiftLoaded && !shiftError" class="text-text-muted">Carregando…</p>
      <AppAlert v-else-if="shiftLoaded && !shift">
        <p class="font-bold">Nenhum turno aberto em {{ unit?.name }}.</p>
        <p>Abra o turno para abrir um caixa.</p>
        <NuxtLink
          :to="`/painel/turnos?unidade=${unit?.id}`"
          class="inline-flex min-h-12 items-center font-bold underline"
          >Abrir turno</NuxtLink
        >
      </AppAlert>

      <template v-else-if="shift">
        <section class="flex flex-col gap-3" aria-labelledby="registers-title">
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="registers-title" class="flex-1 text-xl">Caixas do turno</h2>
            <AppButton
              v-if="!openFormVisible"
              variant="secondary"
              :block="false"
              data-testid="new-register"
              @click="openFormVisible = true"
            >
              <AppIcon name="plus" />
              Abrir caixa
            </AppButton>
          </div>

          <form
            v-if="openFormVisible"
            class="flex flex-col gap-3 rounded-card border-2 border-border bg-surface p-4"
            novalidate
            data-testid="open-register-form"
            @submit.prevent="openRegister"
          >
            <h3 class="text-lg">Abrir caixa</h3>
            <AppTextField
              v-model="nameInput"
              label="Nome (opcional)"
              placeholder="Caixa 1, Caixa 2…"
              :maxlength="REGISTER_NAME_MAX"
              :error="nameError"
              autocomplete="off"
            />
            <AppTextField
              v-model="floatInput"
              label="Troco inicial"
              inputmode="decimal"
              prefix="R$"
              hint="Dinheiro na gaveta ao abrir (pode ser 0)."
              :error="floatError"
              autocomplete="off"
            />
            <ErrorAlert :error="openAction.error.value" @reload="cash.load" />
            <div class="flex flex-wrap gap-2">
              <AppButton
                type="submit"
                variant="secondary"
                :block="false"
                :loading="openAction.busy.value"
                data-testid="open-register"
              >
                Abrir caixa
              </AppButton>
              <AppButton variant="ghost" :block="false" @click="openFormVisible = false">
                Cancelar
              </AppButton>
            </div>
          </form>

          <p v-if="cash.loaded.value && cash.registers.value.length === 0" class="text-text-muted">
            Nenhum caixa aberto neste turno. Sem caixa, o balcão não recebe pagamentos.
          </p>

          <ul class="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <li
              v-for="register in cash.registers.value"
              :key="register.id"
              class="flex flex-col gap-3 rounded-card border-2 border-border bg-surface p-4"
              data-testid="register-card"
              :data-register-name="register.name"
            >
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="flex-1 text-lg">{{ register.name }}</h3>
                <StageChip
                  :status="register.status === 'open' ? 'ready' : 'delivered'"
                  :label="register.status === 'open' ? 'Aberto' : 'Fechado'"
                />
              </div>
              <p class="text-sm text-text-muted">
                Responsável: {{ responsible(register) }} · aberto às
                {{ formatTime(register.openedAt) }}
                <template v-if="register.closedAt">
                  · fechado às {{ formatTime(register.closedAt) }}</template
                >
              </p>

              <dl v-if="register.status === 'open'" class="grid grid-cols-2 gap-1">
                <template v-for="method in PAYMENT_METHODS" :key="method">
                  <dt class="text-text-muted">{{ PAYMENT_METHOD_LABELS[method] }} esperado</dt>
                  <dd class="text-right font-bold tabular-nums" :data-testid="`expected-${method}`">
                    {{ formatCents(expectedOf(register, method)) }}
                  </dd>
                </template>
              </dl>
              <p v-if="register.status === 'open'" class="text-sm text-text-muted tabular-nums">
                Dinheiro = troco inicial {{ formatCents(register.cash.openingFloatCents) }} +
                recebido {{ formatCents(register.cash.paymentsCents) }} + suprimentos
                {{ formatCents(register.cash.depositsCents) }} − sangrias
                {{ formatCents(register.cash.withdrawalsCents) }}
              </p>

              <table v-if="register.status === 'closed'" class="w-full text-left tabular-nums">
                <thead>
                  <tr class="text-sm text-text-muted">
                    <th class="py-1 font-normal">Forma</th>
                    <th class="py-1 text-right font-normal">Esperado</th>
                    <th class="py-1 text-right font-normal">Conferido</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="count in register.counts"
                    :key="count.method"
                    class="border-t border-border"
                  >
                    <td class="py-1">
                      {{ PAYMENT_METHOD_LABELS[count.method] }}
                      <span
                        class="block text-sm"
                        :class="
                          count.differenceCents === 0 ? 'text-text-muted' : 'font-bold text-error'
                        "
                        >{{ differenceLabel(count.differenceCents) }}</span
                      >
                    </td>
                    <td class="py-1 text-right">{{ formatCents(count.expectedCents) }}</td>
                    <td class="py-1 text-right">{{ formatCents(count.informedCents) }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-if="register.closingNote" class="text-sm">
                Observação: {{ register.closingNote }}
              </p>

              <StageChip
                v-for="text in pendingMovements[register.id] ?? []"
                :key="text"
                status="pending"
                :label="text"
              />

              <div v-if="register.status === 'open'" class="flex flex-wrap gap-2">
                <AppButton
                  variant="secondary"
                  :block="false"
                  data-testid="withdrawal"
                  @click="startMovement(register, 'withdrawal')"
                >
                  Sangria
                </AppButton>
                <AppButton
                  variant="secondary"
                  :block="false"
                  data-testid="deposit"
                  @click="startMovement(register, 'deposit')"
                >
                  Suprimento
                </AppButton>
                <AppButton
                  variant="ghost"
                  :block="false"
                  :to="`/caixas/${register.id}/fechar`"
                  data-testid="close-register-link"
                >
                  Fechar caixa
                  <AppIcon name="arrow-right" />
                </AppButton>
              </div>
            </li>
          </ul>
        </section>

        <AppButton :to="`/painel/turnos?unidade=${unit?.id}`" variant="secondary">
          <AppIcon name="calendar" />
          Ver o turno
        </AppButton>
      </template>
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
          Dinheiro esperado agora: {{ formatCents(expectedOf(movement.register, 'cash')) }}.
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
  </component>
</template>
