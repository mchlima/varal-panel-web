<script setup lang="ts">
import { formatDateTime } from '~/lib/datetime'
import { formatCents } from '~/lib/money'
import { sinceLabel } from '~/lib/operation'
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  REGISTER_STATE_LABELS,
  differenceLabel,
  expectedOf,
  expectedSplit,
  registerState,
  type CashMovementType,
  type CashRegister,
} from '~/lib/payment'

/**
 * Um caixa cadastrado na tela de caixas (spec 05, seção 8). Fechado: nome, último fechamento e
 * "Abrir caixa". Aberto: responsável, desde quando (com o alerta da RN-05.26 quando a abertura é
 * de um dia anterior), esperado por forma (RN-05.19, RN-05.22), "Sangria", "Suprimento" e
 * "Fechar caixa". `primary` deixa o botão principal preenchido: só quando é a única ação da tela
 * (spec 08, CA-08.02).
 */
const props = withDefaults(
  defineProps<{
    register: CashRegister
    primary?: boolean
    /** Repassado para a abertura (`?volta=balcao`). */
    back?: string | null
    pending?: string[]
  }>(),
  { primary: false, back: null, pending: () => [] },
)
const emit = defineEmits<{ movement: [type: CashMovementType] }>()

const state = computed(() => registerState(props.register))
const session = computed(() => props.register.session)
const openPath = computed(
  () => `/caixas/${props.register.id}/abrir${props.back ? `?volta=${props.back}` : ''}`,
)
const forgotten = computed(() => state.value === 'open' && session.value?.openSinceEarlierDay)
</script>

<template>
  <article
    class="flex flex-col gap-3 rounded-card border-2 bg-surface p-4"
    :class="forgotten ? 'border-status-late-text' : 'border-border'"
    data-testid="register-card"
    :data-register-name="register.name"
    :data-state="state"
  >
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="flex-1 text-xl">{{ register.name }}</h2>
      <StageChip
        :status="state === 'open' ? 'ready' : 'delivered'"
        :label="REGISTER_STATE_LABELS[state]"
      />
    </div>

    <!-- Fechado ou nunca aberto -->
    <template v-if="state !== 'open'">
      <p v-if="session?.closedAt" class="text-text-muted">
        Último fechamento: {{ formatDateTime(session.closedAt) }}
        <template v-if="session.differenceCents !== 0">
          · {{ differenceLabel(session.differenceCents) }}</template
        >
      </p>
      <p v-else class="text-text-muted">Este caixa ainda não foi aberto.</p>
      <p class="text-sm text-text-muted">
        Abrir o caixa começa o dia: o balcão passa a poder abrir comandas e receber.
      </p>
      <AppButton
        :variant="primary ? 'primary' : 'secondary'"
        :to="openPath"
        data-testid="open-register"
      >
        <AppIcon name="wallet" />
        Abrir {{ register.name }}
      </AppButton>
    </template>

    <!-- Aberto -->
    <template v-else-if="session">
      <AppAlert v-if="forgotten" tone="error">
        <p class="font-bold" data-testid="open-since-earlier">
          {{ register.name }} aberto desde {{ sinceLabel(session.openedAt) }}.
        </p>
        <p class="text-text">
          Feche este caixa para conferir o dinheiro do dia anterior. Para vender hoje, abra de novo
          depois.
        </p>
      </AppAlert>
      <p class="text-text-muted">
        Aberto por
        <strong class="text-text">{{ session.openedByName ?? 'Colaborador' }}</strong> desde
        {{ sinceLabel(session.openedAt) }} · troco inicial
        {{ formatCents(session.openingFloatCents) }}
      </p>

      <dl class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        <template v-for="method in PAYMENT_METHODS" :key="method">
          <dt class="text-text-muted">{{ PAYMENT_METHOD_LABELS[method] }} esperado</dt>
          <dd class="text-right font-bold tabular-nums" :data-testid="`expected-${method}`">
            {{ formatCents(expectedOf(session, method)) }}
          </dd>
          <dd
            v-if="expectedSplit(session, method).creditSettlementsCents > 0"
            class="col-span-2 -mt-1 text-right text-sm text-text-muted tabular-nums"
          >
            inclui {{ formatCents(expectedSplit(session, method).creditSettlementsCents) }} de
            quitações de fiado
          </dd>
        </template>
      </dl>
      <p class="text-sm text-text-muted tabular-nums">
        Dinheiro = troco {{ formatCents(session.cash.openingFloatCents) }} + recebido
        {{ formatCents(session.cash.paymentsCents) }} + suprimentos
        {{ formatCents(session.cash.depositsCents) }} − sangrias
        {{ formatCents(session.cash.withdrawalsCents) }}
      </p>

      <StageChip v-for="text in pending" :key="text" status="pending" :label="text" />

      <div class="grid grid-cols-2 gap-2">
        <AppButton
          variant="secondary"
          data-testid="withdrawal"
          @click="emit('movement', 'withdrawal')"
        >
          Sangria
        </AppButton>
        <AppButton variant="secondary" data-testid="deposit" @click="emit('movement', 'deposit')">
          Suprimento
        </AppButton>
      </div>
      <AppButton
        :variant="primary ? 'primary' : 'secondary'"
        :to="`/caixas/${register.id}/fechar`"
        data-testid="close-register-link"
      >
        <AppIcon name="check" />
        Fechar {{ register.name }}
      </AppButton>
    </template>
  </article>
</template>
