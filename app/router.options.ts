import type { RouterConfig } from '@nuxt/schema'

/**
 * O link de definir senha leva o token no fragmento (`#token=...&tipo=...`, spec 01,
 * seção 7.4). Esse fragmento não é âncora: rolar até ele quebraria o seletor CSS.
 */
export default {
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash && /^#[\w-]+$/.test(to.hash)) return { el: to.hash }
    return { top: 0 }
  },
} satisfies RouterConfig
