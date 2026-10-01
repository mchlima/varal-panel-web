<script setup lang="ts">
import { formatCents } from '~/lib/money'
import { NOTE_MAX, QUANTITY_MAX, rejectionMessage } from '~/lib/operation'
import {
  cartTotalCents,
  lineTotalCents,
  unavailableLines,
  type MenuProduct,
} from '~/lib/order-builder'

/**
 * Revisão do pedido (spec 04, seção 8.1): linhas com quantidade, observação e "Tirar", os
 * problemas de cada linha (esgotado agora, recusa `ORDER_REJECTED` apontada pelo índice,
 * RN-04.17) e o total.
 */
const props = defineProps<{
  cartKey: string
  availableProduct: (id: string) => MenuProduct | null
}>()

const cart = useCartStore()
const current = computed(() => cart.cartOf(props.cartKey))
const unavailable = computed(
  () => new Set(unavailableLines(current.value.lines, props.availableProduct)),
)
const total = computed(() => cartTotalCents(current.value.lines))
const editingNote = ref<string | null>(null)
const noteDraft = ref('')

function startNote(key: string, note: string) {
  editingNote.value = key
  noteDraft.value = note
}

function saveNote(key: string) {
  cart.setNote(props.cartKey, key, noteDraft.value)
  editingNote.value = null
}

function lineProblems(key: string): string[] {
  const problems: string[] = []
  if (unavailable.value.has(key))
    problems.push('Esgotado ou fora do cardápio agora: tire do pedido.')
  for (const rejection of current.value.rejections[key] ?? []) {
    const line = current.value.lines.find((item) => item.key === key)
    const group = line?.modifiers.find((modifier) => modifier.groupId === rejection.modifierGroupId)
    const groupName =
      group?.groupName ??
      props
        .availableProduct(rejection.productId)
        ?.modifierGroups.find((g) => g.id === rejection.modifierGroupId)?.name
    const message = rejectionMessage(rejection.reason, groupName)
    if (!problems.includes(message)) problems.push(message)
  }
  return problems
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <ul class="flex flex-col gap-3">
      <li
        v-for="line in current.lines"
        :key="line.key"
        class="flex flex-col gap-2 rounded-card border-2 bg-surface p-3"
        :class="lineProblems(line.key).length ? 'border-error' : 'border-border'"
        data-testid="cart-line"
      >
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <p class="text-lg font-bold">{{ line.productName }}</p>
            <p v-if="line.modifiers.length" class="text-sm text-text-muted">
              {{ line.modifiers.map((modifier) => modifier.name).join(', ') }}
            </p>
            <p v-if="line.note" class="text-sm font-bold">Obs.: {{ line.note }}</p>
          </div>
          <span class="font-bold whitespace-nowrap tabular-nums">{{
            formatCents(lineTotalCents(line))
          }}</span>
        </div>
        <p
          v-for="problem in lineProblems(line.key)"
          :key="problem"
          class="flex items-center gap-1.5 text-sm font-bold text-error"
          data-testid="line-problem"
        >
          <AppIcon name="alert-circle" :size="16" />
          {{ problem }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <QuantityStepper
            :model-value="line.quantity"
            :min="0"
            :max="QUANTITY_MAX"
            :label="`Quantidade de ${line.productName}`"
            @update:model-value="cart.setQuantity(cartKey, line.key, $event)"
          />
          <button
            type="button"
            class="min-h-12 rounded-button px-3 font-bold text-primary-deep underline-offset-4 hover:underline"
            @click="startNote(line.key, line.note)"
          >
            Observação
          </button>
          <button
            type="button"
            class="ml-auto min-h-12 rounded-button px-3 font-bold text-status-late-text underline-offset-4 hover:underline"
            @click="cart.setQuantity(cartKey, line.key, 0)"
          >
            Tirar
          </button>
        </div>
        <div v-if="editingNote === line.key" class="flex flex-col gap-2">
          <label class="flex flex-col gap-1">
            <span class="font-bold">Observação de {{ line.productName }}</span>
            <textarea
              v-model="noteDraft"
              :maxlength="NOTE_MAX"
              rows="2"
              class="w-full rounded-button border-2 border-border-strong bg-surface px-4 py-2"
            />
            <span class="self-end text-sm text-text-muted tabular-nums"
              >{{ noteDraft.length }}/{{ NOTE_MAX }}</span
            >
          </label>
          <AppButton variant="secondary" :block="false" @click="saveNote(line.key)">
            Salvar observação
          </AppButton>
        </div>
      </li>
    </ul>
    <p v-if="current.lines.length === 0" class="text-text-muted">O pedido está vazio.</p>
    <div class="flex items-baseline justify-between border-t border-border pt-3">
      <span class="font-bold">Total do pedido</span>
      <span class="font-display text-2xl font-extrabold tabular-nums" data-testid="cart-total">{{
        formatCents(total)
      }}</span>
    </div>
  </div>
</template>
