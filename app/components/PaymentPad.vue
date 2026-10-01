<script setup lang="ts">
import type { IconName } from './AppIcon.vue'
import { formatCents } from '~/lib/money'
import {
  PAYMENT_METHOD_LABELS,
  RECEIVE_METHODS,
  cashChange,
  paymentIssue,
  pressKey,
  type KeypadKey,
  type PaymentMethod,
} from '~/lib/payment'

/**
 * Receber (spec 05, seção 8; spec 08, seção 6): botões grandes Pix, Dinheiro, Crédito e Débito,
 * teclado numérico e, no dinheiro, "Valor entregue" com o troco em letra grande (RN-05.09). O
 * valor começa no saldo (Pix e cartões) e o primeiro toque no teclado o substitui. A tela dona
 * do componente mostra o botão de confirmar no rodapé, com valor e forma.
 */
const props = withDefaults(defineProps<{ balanceCents: number; disabled?: boolean }>(), {
  disabled: false,
})
const method = defineModel<PaymentMethod | null>('method', { required: true })
const cents = defineModel<number>('cents', { required: true })

const ICONS: Record<PaymentMethod, IconName> = {
  pix: 'pix',
  cash: 'cash',
  credit_card: 'card',
  debit_card: 'card',
}
const KEYS: KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back']

const labelId = useId()

/** O valor mostrado ainda é o sugerido: o primeiro dígito começa um valor novo. */
const fresh = ref(true)

function choose(next: PaymentMethod) {
  method.value = next
  // Pix e cartões começam no saldo; dinheiro começa vazio (o cliente diz quanto entregou).
  cents.value = next === 'cash' ? 0 : Math.max(0, props.balanceCents)
  fresh.value = true
}

function press(key: KeypadKey) {
  if (props.disabled || !method.value) return
  const base = fresh.value && key !== 'back' ? 0 : cents.value
  cents.value = pressKey(base, key)
  fresh.value = false
}

function setAmount(value: number) {
  cents.value = value
  fresh.value = true
}

/** Notas que o cliente costuma entregar, acima do saldo (atalhos do dinheiro). */
const suggestions = computed(() => {
  const balance = props.balanceCents
  if (balance <= 0) return []
  const result = new Set<number>([balance])
  for (const step of [500, 1000, 2000, 5000, 10_000, 20_000]) {
    const rounded = Math.ceil(balance / step) * step
    if (rounded > balance) result.add(rounded)
    if (result.size >= 4) break
  }
  return [...result].sort((a, b) => a - b)
})

const change = computed(() => cashChange(cents.value, props.balanceCents))
const issue = computed(() =>
  method.value && !(fresh.value && cents.value === 0 && method.value === 'cash')
    ? paymentIssue(method.value, cents.value, props.balanceCents)
    : null,
)

// Teclado físico (tablet com teclado, testes): dígitos e apagar, fora de campos de texto.
function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
  if (/^[0-9]$/.test(event.key)) press(event.key as KeypadKey)
  else if (event.key === 'Backspace') press('back')
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// O saldo mudou (outro pagamento chegou): o valor sugerido acompanha.
watch(
  () => props.balanceCents,
  (balance) => {
    if (fresh.value && method.value && method.value !== 'cash') cents.value = Math.max(0, balance)
  },
)
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="payment-pad">
    <div role="group" aria-label="Forma de pagamento" class="grid grid-cols-2 gap-2">
      <button
        v-for="option in RECEIVE_METHODS"
        :key="option"
        type="button"
        :aria-pressed="method === option"
        :disabled="disabled"
        class="flex min-h-16 items-center justify-center gap-2 rounded-card border-2 px-3 text-lg font-bold disabled:opacity-60"
        :class="
          method === option
            ? 'border-primary bg-primary-soft text-primary-deep'
            : 'border-border-strong bg-surface text-text hover:border-primary'
        "
        :data-testid="`method-${option}`"
        @click="choose(option)"
      >
        <AppIcon :name="ICONS[option]" :size="24" />
        {{ PAYMENT_METHOD_LABELS[option] }}
      </button>
    </div>

    <p v-if="!method" class="text-text-muted">Escolha a forma de pagamento.</p>
    <template v-else>
      <div class="flex flex-col gap-1 rounded-card border-2 border-border bg-surface p-4">
        <span :id="labelId" class="text-sm font-bold text-text-muted">{{
          method === 'cash' ? 'Valor entregue' : `Valor no ${PAYMENT_METHOD_LABELS[method]}`
        }}</span>
        <output
          :aria-labelledby="labelId"
          aria-live="polite"
          class="font-display text-[2.5rem] leading-none font-extrabold tabular-nums"
          data-testid="pad-amount"
          >{{ formatCents(cents) }}</output
        >
        <template v-if="method === 'cash'">
          <div class="mt-2 flex items-baseline justify-between gap-2 border-t border-border pt-2">
            <span class="text-lg font-bold">Troco</span>
            <span
              class="font-display text-[2rem] leading-none font-extrabold text-primary-deep tabular-nums"
              data-testid="change"
              >{{ formatCents(change.changeCents) }}</span
            >
          </div>
          <p class="text-sm text-text-muted tabular-nums">
            Entra na comanda: {{ formatCents(change.appliedCents) }}
          </p>
        </template>
        <!-- Linha reservada: o aviso aparecer não muda a altura (botões não saem do lugar). -->
        <p
          class="flex min-h-6 items-center gap-1.5 text-sm font-bold text-error"
          role="status"
          data-testid="pad-issue"
        >
          <template v-if="issue">
            <AppIcon name="alert-circle" :size="16" />
            {{ issue }}
          </template>
        </p>
      </div>

      <div v-if="method === 'cash'" class="flex flex-wrap gap-2" aria-label="Atalhos de valor">
        <button
          v-for="value in suggestions"
          :key="value"
          type="button"
          class="min-h-12 rounded-button border-2 border-border-strong bg-surface px-3 font-bold tabular-nums"
          @click="setAmount(value)"
        >
          {{ value === balanceCents ? `Exato ${formatCents(value)}` : formatCents(value) }}
        </button>
      </div>

      <div role="group" aria-label="Teclado numérico" class="grid grid-cols-3 gap-2">
        <button
          v-for="key in KEYS"
          :key="key"
          type="button"
          :disabled="disabled"
          class="flex min-h-14 items-center justify-center rounded-button border-2 border-border bg-surface font-display text-2xl font-bold tabular-nums hover:border-border-strong disabled:opacity-60"
          :aria-label="key === 'back' ? 'Apagar' : key"
          :data-testid="`key-${key}`"
          @click="press(key)"
        >
          <AppIcon v-if="key === 'back'" name="backspace" :size="24" />
          <template v-else>{{ key }}</template>
        </button>
      </div>
    </template>
  </div>
</template>
