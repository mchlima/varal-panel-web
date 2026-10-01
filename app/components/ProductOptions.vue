<script setup lang="ts">
import { choicesLabel } from '~/lib/setup'
import { formatCents, formatDelta } from '~/lib/money'
import { NOTE_MAX, QUANTITY_MAX } from '~/lib/operation'
import {
  buildLine,
  chosenModifiers,
  previewTotalCents,
  selectionIssues,
  toggleModifier,
  visibleGroups,
  type CartLine,
  type MenuProduct,
  type Selection,
  type ShiftPrice,
} from '~/lib/order-builder'

/**
 * Folha de opções do produto (spec 04, seção 8.1): grupos de modificadores com mínimo e máximo
 * (RN-03.13; obrigatório não deixa adicionar sem escolha, CA-03.06), quantidade e observação
 * de até 140 caracteres (RN-04.16).
 */
const props = withDefaults(
  defineProps<{ product: MenuProduct; shiftPrices?: readonly ShiftPrice[] }>(),
  { shiftPrices: () => [] },
)
const emit = defineEmits<{ add: [line: CartLine] }>()

const groups = computed(() => visibleGroups(props.product))
const selection = ref<Selection>({})
const quantity = ref(1)
const note = ref('')
const tried = ref(false)

const unitPrice = computed(
  () =>
    buildLine({
      product: props.product,
      shiftPrices: props.shiftPrices,
      modifiers: [],
      quantity: 1,
      note: '',
    }).unitPriceCents,
)
const modifiers = computed(() => chosenModifiers(groups.value, selection.value))
const issues = computed(() => selectionIssues(groups.value, selection.value))
const issueByGroup = computed(() =>
  Object.fromEntries(issues.value.map((issue) => [issue.groupId, issue.message])),
)
const total = computed(() => previewTotalCents(unitPrice.value, modifiers.value, quantity.value))

function toggle(groupId: string, modifierId: string) {
  const group = groups.value.find((item) => item.id === groupId)
  if (group) selection.value = toggleModifier(selection.value, group, modifierId)
}

function isChosen(groupId: string, modifierId: string) {
  return (selection.value[groupId] ?? []).includes(modifierId)
}

function atLimit(groupId: string, max: number) {
  return max > 1 && (selection.value[groupId] ?? []).length >= max
}

function add() {
  tried.value = true
  if (issues.value.length > 0) return
  emit(
    'add',
    buildLine({
      product: props.product,
      shiftPrices: props.shiftPrices,
      modifiers: modifiers.value,
      quantity: quantity.value,
      note: note.value,
    }),
  )
}
</script>

<template>
  <form class="flex flex-col gap-5" novalidate @submit.prevent="add">
    <p class="text-text-muted">
      {{ formatCents(unitPrice) }} cada<template v-if="product.description">
        · {{ product.description }}</template
      >
    </p>

    <fieldset
      v-for="group in groups"
      :key="group.id"
      class="flex flex-col gap-2"
      :aria-describedby="tried && issueByGroup[group.id] ? `issue-${group.id}` : undefined"
      :data-testid="`group-${group.name}`"
    >
      <legend class="mb-1 flex w-full flex-wrap items-baseline gap-2">
        <span class="font-display text-lg font-semibold">{{ group.name }}</span>
        <span class="text-sm text-text-muted">{{
          choicesLabel(group.minChoices, group.maxChoices)
        }}</span>
      </legend>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          v-for="modifier in group.modifiers"
          :key="modifier.id"
          type="button"
          :aria-pressed="isChosen(group.id, modifier.id)"
          :disabled="!isChosen(group.id, modifier.id) && atLimit(group.id, group.maxChoices)"
          class="flex min-h-13 items-center gap-3 rounded-button border-2 px-3 text-left font-bold disabled:opacity-50"
          :class="
            isChosen(group.id, modifier.id)
              ? 'border-primary bg-primary-soft text-primary-deep'
              : 'border-border-strong bg-surface text-text'
          "
          @click="toggle(group.id, modifier.id)"
        >
          <AppIcon :name="isChosen(group.id, modifier.id) ? 'check-circle' : 'plus'" />
          <span class="flex-1">{{ modifier.name }}</span>
          <span class="text-sm font-normal">{{ formatDelta(modifier.priceDeltaCents) }}</span>
        </button>
      </div>
      <p
        v-if="tried && issueByGroup[group.id]"
        :id="`issue-${group.id}`"
        class="flex items-center gap-1.5 text-sm font-bold text-error"
        role="alert"
      >
        <AppIcon name="alert-circle" :size="16" />
        {{ issueByGroup[group.id] }}
      </p>
    </fieldset>

    <div class="flex flex-wrap items-center gap-3">
      <span class="font-bold">Quantidade</span>
      <QuantityStepper v-model="quantity" :max="QUANTITY_MAX" label="Quantidade" />
    </div>

    <label class="flex flex-col gap-1.5">
      <span class="font-bold">Observação</span>
      <textarea
        v-model="note"
        :maxlength="NOTE_MAX"
        rows="2"
        placeholder="Ex.: bem tostado, sem sal"
        class="min-h-12 w-full rounded-button border-2 border-border-strong bg-surface px-4 py-2 text-base"
      />
      <span class="self-end text-sm text-text-muted tabular-nums"
        >{{ note.length }}/{{ NOTE_MAX }}</span
      >
    </label>

    <AppButton type="submit" data-testid="add-to-order">
      Adicionar · {{ formatCents(total) }}
    </AppButton>
  </form>
</template>
