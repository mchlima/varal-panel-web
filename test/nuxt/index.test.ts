import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import IndexPage from '~/pages/index.vue'

describe('página inicial provisória', () => {
  it('mostra o logo da spec 08 (RN-08.01) e a frase "Em breve."', async () => {
    const wrapper = await mountSuspended(IndexPage)

    const logo = wrapper.get('img')
    expect(logo.attributes('src')).toBe('/logo.svg')
    expect(logo.attributes('alt')).toBe('Varal')
    expect(wrapper.text()).toContain('Em breve.')
  })

  it('usa os tokens de cor e a fonte de destaque', async () => {
    const wrapper = await mountSuspended(IndexPage)

    expect(wrapper.get('main').classes()).toContain('bg-bg')
    expect(wrapper.get('p').classes()).toEqual(
      expect.arrayContaining(['font-display', 'text-primary-deep']),
    )
  })
})
