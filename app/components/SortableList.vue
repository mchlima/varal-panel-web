<script setup lang="ts" generic="T extends { id: string }">
import { moveItem, sameOrder } from '~/lib/list'

/**
 * Lista ordenável (spec 03, seção 9: "arrastar para ordenar"). Arrastar pela alça funciona
 * com dedo e mouse (eventos de ponteiro); os botões ↑ e ↓ são a alternativa acessível,
 * para teclado e leitor de tela. Emite `reorder` com todos os ids na nova ordem.
 */
const props = withDefaults(
  defineProps<{
    items: T[]
    itemLabel: (item: T) => string
    disabled?: boolean
    /** Nome da lista para os anúncios ("categoria", "produto"…). */
    noun?: string
  }>(),
  { disabled: false, noun: 'item' },
)
const emit = defineEmits<{ reorder: [ids: string[]] }>()

const order = ref<T[]>([...props.items]) as Ref<T[]>
watch(
  () => props.items,
  (items) => {
    order.value = [...items]
  },
)
const listEl = ref<HTMLElement | null>(null)
const draggingId = ref<string | null>(null)
const announcement = ref('')
let startIds: string[] = []

const ids = () => order.value.map((item) => item.id)

function announce(item: T, index: number) {
  announcement.value = `${props.itemLabel(item)} na posição ${index + 1} de ${order.value.length}.`
}

function commit() {
  const next = ids()
  if (!sameOrder(next, startIds)) emit('reorder', next)
}

function move(index: number, delta: number) {
  const target = index + delta
  if (props.disabled || target < 0 || target >= order.value.length) return
  startIds = ids()
  const item = order.value[index]!
  order.value = moveItem(order.value, index, target)
  announce(item, target)
  commit()
}

function onPointerDown(event: PointerEvent, id: string) {
  if (props.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  startIds = ids()
  draggingId.value = id
}

function onPointerMove(event: PointerEvent) {
  if (!draggingId.value || !listEl.value) return
  const rows = [...listEl.value.querySelectorAll<HTMLElement>(':scope > [data-sortable-row]')]
  const from = order.value.findIndex((item) => item.id === draggingId.value)
  let to = rows.findIndex((row) => {
    const rect = row.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2
  })
  if (to === -1) to = rows.length - 1
  else if (to > from) to -= 1
  if (from !== -1 && to !== from) order.value = moveItem(order.value, from, to)
}

function onPointerUp() {
  if (!draggingId.value) return
  const index = order.value.findIndex((item) => item.id === draggingId.value)
  draggingId.value = null
  if (index !== -1) announce(order.value[index]!, index)
  commit()
}
</script>

<template>
  <div>
    <ul ref="listEl" class="flex flex-col gap-2">
      <li
        v-for="(item, index) in order"
        :key="item.id"
        data-sortable-row
        class="flex items-stretch gap-1 rounded-card border bg-surface"
        :class="draggingId === item.id ? 'border-primary ring-2 ring-primary' : 'border-border'"
      >
        <button
          type="button"
          class="flex w-10 shrink-0 cursor-grab touch-none items-center justify-center text-text-muted disabled:cursor-not-allowed"
          :aria-label="`Arrastar ${itemLabel(item)}`"
          :disabled="disabled"
          @pointerdown="onPointerDown($event, item.id)"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <AppIcon name="grip" />
        </button>
        <div class="min-w-0 flex-1 py-2">
          <slot :item="item" :index="index" />
        </div>
        <div class="flex shrink-0 flex-col">
          <button
            type="button"
            class="flex size-12 items-center justify-center rounded-button text-primary-deep disabled:text-border"
            :aria-label="`Subir ${itemLabel(item)}`"
            :disabled="disabled || index === 0"
            @click="move(index, -1)"
          >
            <AppIcon name="arrow-up" />
          </button>
          <button
            type="button"
            class="flex size-12 items-center justify-center rounded-button text-primary-deep disabled:text-border"
            :aria-label="`Descer ${itemLabel(item)}`"
            :disabled="disabled || index === order.length - 1"
            @click="move(index, 1)"
          >
            <AppIcon name="arrow-down" />
          </button>
        </div>
      </li>
    </ul>
    <p aria-live="polite" class="sr-only">{{ announcement }}</p>
  </div>
</template>
