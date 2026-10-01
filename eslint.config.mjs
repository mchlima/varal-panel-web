// @ts-check
import prettier from 'eslint-config-prettier/flat'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    // Gerado por `pnpm gen:api`; nunca editado à mão.
    ignores: ['app/api/schema.d.ts'],
  },
  prettier,
)
