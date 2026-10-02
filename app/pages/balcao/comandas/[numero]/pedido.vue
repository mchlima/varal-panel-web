<script setup lang="ts">
import { formatCents } from '~/lib/money'
import { itemsLabel, rejectionsOf, tabLabel } from '~/lib/operation'
import {
  cartIssue,
  cartTotalCents,
  cartUnits,
  rejectionsByLine,
  toOrderBody,
  unavailableLines,
} from '~/lib/order-builder'

/**
 * Montar pedido (`/balcao/comandas/{numero}/pedido`, spec 04, seção 8.1): categorias em abas,
 * busca, produtos em botões grandes com o preço da tabela efetiva (RN-04.33), esgotados
 * visíveis e bloqueados (RN-03.10, CA-03.05), folha de opções (RN-03.13), carrinho com
 * quantidades e total, revisão e envio. O envio vai pela fila local (spec 01, seção 11): com
 * rede, a tela espera a resposta e trata `ORDER_REJECTED` apontando os itens (RN-04.17,
 * CA-04.06); sem rede, o pedido fica "Na fila" na comanda e vai uma vez só (CA-01.07).
 */
const route = useRoute()
const number = computed(() => Number(route.params.numero))
const { place, counter, operation } = useCounterLive()
/** RN-04.02: lançar pedido exige caixa aberto (enquanto carrega, deixa). */
const selling = computed(() => operation.value?.inOperation !== false)
const priceListName = computed(() => operation.value?.effectivePriceList?.name ?? null)
const cart = useCartStore()
const operations = useOperations()
const connection = useConnectionStore()
const unitId = computed(() => place.value?.unit.id ?? null)
const { menu, categories, availableProduct } = useCounterMenu(unitId)

useHead({ title: () => `Pedido · comanda ${number.value} · Varal` })

const tab = computed(() => counter.tabByNumber(number.value))
const tabId = computed(() => tab.value?.id ?? null)
const { notice: failureNotice } = useOrderFailures(tabId)
const current = computed(() =>
  tab.value ? cart.cartOf(tab.value.id) : { lines: [], rejections: {} },
)
const unavailable = computed(() => new Set(unavailableLines(current.value.lines, availableProduct)))
const total = computed(() => cartTotalCents(current.value.lines))
const units = computed(() => cartUnits(current.value.lines))

const reviewOpen = ref(false)
const sending = ref(false)
const sendError = ref('')

const blocking = computed(() => {
  const issue = cartIssue(current.value.lines)
  if (issue) return issue
  if (unavailable.value.size > 0) return 'Tire do pedido os itens esgotados para enviar.'
  return null
})

/** Com rede a resposta chega rápido; passado isso, o pedido segue na fila e a tela volta. */
const WAIT_FOR_ORDER_MS = 2_500

async function send() {
  const target = tab.value
  if (!target || blocking.value || sending.value) return
  sending.value = true
  sendError.value = ''
  const lines = current.value.lines
  try {
    const { settled } = await operations.submit({
      path: `/api/v1/tabs/${target.id}/orders`,
      body: toOrderBody(lines),
      label: `Pedido da comanda ${tabLabel(target)} (${itemsLabel(lines.length)})`,
      meta: { kind: 'tab.order', tabId: target.id, tabNumber: target.number, lines },
    })
    // A partir daqui o pedido é da fila: o carrinho esvazia e, se for recusado, as linhas voltam.
    cart.clear(target.id)
    const outcome = connection.online
      ? await Promise.race([
          settled,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_FOR_ORDER_MS)),
        ])
      : null
    if (outcome && !outcome.ok) {
      // useOrderFailures devolve as linhas ao carrinho; aqui só mantém a revisão aberta.
      if (outcome.error.code === 'ORDER_REJECTED') {
        cart.setRejections(target.id, rejectionsByLine(lines, rejectionsOf(outcome.error.details)))
      }
      sendError.value = outcome.error.message
      return
    }
    reviewOpen.value = false
    await navigateTo(`/balcao/comandas/${target.number}`)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div>
    <OperationShell
      :title="tab ? `Pedido · ${tabLabel(tab)}` : `Pedido · comanda ${number}`"
      :unit-name="place?.unit.name"
      :back="`/balcao/comandas/${number}`"
      back-label="Voltar à comanda"
      wide
    >
      <AppAlert v-if="!place">
        Escolha uma estação de balcão liberada para você em "Trocar de estação".
      </AppAlert>
      <p v-else-if="!tab && (counter.loading || !counter.loaded)" class="text-text-muted">
        Carregando…
      </p>
      <AppAlert v-else-if="!tab" tone="error">
        A comanda {{ number }} não está aberta nesta unidade.
        <NuxtLink to="/balcao" class="font-bold underline">Voltar ao varal</NuxtLink>
      </AppAlert>
      <template v-else>
        <AppAlert v-if="tab.status !== 'open'">
          Esta comanda está pedindo a conta. Reabra a comanda para lançar pedidos.
          <NuxtLink :to="`/balcao/comandas/${tab.number}`" class="font-bold underline">
            Ver comanda
          </NuxtLink>
        </AppAlert>
        <NoCashNotice v-if="!selling" :unit-id="place.unit.id" :primary="false" />
        <AppAlert v-if="failureNotice" tone="error">{{ failureNotice }}</AppAlert>
        <AppAlert v-if="menu.loadError" tone="error">{{ menu.loadError }}</AppAlert>

        <ProductPicker
          :categories="categories"
          :cart-key="tab.id"
          :price-list-name="priceListName"
          :loading="menu.loading"
          :disabled="tab.status !== 'open' || !selling"
        />
      </template>

      <template v-if="place" #top>
        <OperationStrip :unit-id="place.unit.id" :operation="operation" />
      </template>
      <template v-if="tab && tab.status === 'open'" #footer>
        <AppButton
          :disabled="units === 0 || !selling"
          data-testid="review-order"
          @click="reviewOpen = true"
        >
          <template v-if="units === 0">Toque nos produtos para montar o pedido</template>
          <template v-else
            >Revisar pedido · {{ itemsLabel(units) }} · {{ formatCents(total) }}</template
          >
        </AppButton>
      </template>
    </OperationShell>

    <AppDialog v-model:open="reviewOpen" title="Revisar pedido">
      <div v-if="tab" class="flex flex-col gap-4">
        <p class="text-text-muted">Comanda {{ tabLabel(tab) }}</p>
        <CartReview :cart-key="tab.id" :available-product="availableProduct" />
        <AppAlert v-if="sendError" tone="error">{{ sendError }}</AppAlert>
        <AppAlert v-else-if="blocking && current.lines.length > 0" tone="error">{{
          blocking
        }}</AppAlert>
        <AppButton :loading="sending" :disabled="!!blocking" data-testid="send-order" @click="send">
          <AppIcon v-if="!sending" name="send" />
          Enviar pedido
        </AppButton>
      </div>
    </AppDialog>
  </div>
</template>
