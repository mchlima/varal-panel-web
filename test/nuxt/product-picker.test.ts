import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import CartReview from '~/components/CartReview.vue'
import ProductPicker from '~/components/ProductPicker.vue'
import { skewer } from '../support/operation-fixtures'

const CART = 'tab-picker-test'
const plain = skewer({ id: 'p-plain', name: 'Espeto Coração', modifierGroups: [] })

describe('ProductPicker: contador e tirar no próprio botão do produto', () => {
  afterEach(() => useCartStore().clear(CART))

  it('mostra a quantidade como número e tira uma unidade de cada vez', async () => {
    const picker = await mountSuspended(ProductPicker, {
      props: { categories: [{ id: 'c1', name: 'Espetos', products: [plain] }], cartKey: CART },
    })
    expect(picker.find('[data-testid="product-count"]').exists()).toBe(false)
    expect(picker.find('[data-testid="product-remove-one"]').exists()).toBe(false)

    const product = picker.get('[data-testid="product-button"]')
    await product.trigger('click')
    await product.trigger('click')
    await product.trigger('click')
    expect(picker.get('[data-testid="product-count"]').text()).toBe('3')
    expect(picker.text()).not.toContain('no pedido')

    await picker.get('[data-testid="product-remove-one"]').trigger('click')
    expect(picker.get('[data-testid="product-count"]').text()).toBe('2')

    await picker.get('[data-testid="product-remove-one"]').trigger('click')
    await picker.get('[data-testid="product-remove-one"]').trigger('click')
    expect(picker.find('[data-testid="product-count"]').exists()).toBe(false)
    expect(useCartStore().cartOf(CART).lines).toHaveLength(0)
  })

  it('a revisão tira todos os itens de uma vez', async () => {
    const picker = await mountSuspended(ProductPicker, {
      props: { categories: [{ id: 'c1', name: 'Espetos', products: [plain] }], cartKey: CART },
    })
    await picker.get('[data-testid="product-button"]').trigger('click')
    await picker.get('[data-testid="product-button"]').trigger('click')

    const review = await mountSuspended(CartReview, {
      props: { cartKey: CART, availableProduct: () => plain },
    })
    await review.get('[data-testid="cart-clear"]').trigger('click')
    expect(useCartStore().cartOf(CART).lines).toHaveLength(0)
    expect(review.text()).toContain('O pedido está vazio.')
  })
})
