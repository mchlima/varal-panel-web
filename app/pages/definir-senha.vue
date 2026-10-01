<script setup lang="ts">
import { apiErrorCode, apiErrorMessage } from '~/lib/api-error'

/**
 * Convite e redefinição de senha (spec 01, seção 7.4). O link é
 * `/definir-senha#token=...&tipo=convite|redefinicao`: o token vem no fragmento, que não
 * vai para servidores nem logs. Depois de lido, o fragmento sai da barra de endereço.
 */
type LinkKind = 'convite' | 'redefinicao'

useHead({ title: 'Definir senha · Varal' })

const MIN_LENGTH = 8

const { $api } = useNuxtApp()
const token = ref('')
const kind = ref<LinkKind>('redefinicao')
const password = ref('')
const confirmation = ref('')
const errors = reactive<{ password?: string; confirmation?: string }>({})
const formError = ref('')
const tokenRejected = ref(false)
const submitting = ref(false)
const done = ref(false)
const ready = ref(false)

const title = computed(() => (kind.value === 'convite' ? 'Crie sua senha' : 'Nova senha'))

onMounted(() => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  token.value = params.get('token') ?? ''
  kind.value = params.get('tipo') === 'convite' ? 'convite' : 'redefinicao'
  if (window.location.hash) {
    // Tira o token da barra de endereço e do histórico, mantendo o estado do roteador.
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    )
  }
  ready.value = true
})

function validate(): boolean {
  errors.password = undefined
  errors.confirmation = undefined
  if (password.value.length < MIN_LENGTH) {
    errors.password = `A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`
  } else if (password.value.length > 128) {
    errors.password = 'A senha pode ter no máximo 128 caracteres.'
  }
  if (!errors.password && confirmation.value !== password.value) {
    errors.confirmation = 'As duas senhas não são iguais.'
  }
  return !errors.password && !errors.confirmation
}

async function submit() {
  formError.value = ''
  if (!validate()) return
  submitting.value = true
  try {
    const { error, response } = await $api.POST('/api/v1/auth/password/reset', {
      body: { token: token.value, password: password.value },
    })
    if (response.ok) {
      done.value = true
      token.value = ''
    } else {
      formError.value = apiErrorMessage(error)
      tokenRejected.value = apiErrorCode(error) === 'INVALID_PASSWORD_TOKEN'
    }
  } catch (error) {
    formError.value = apiErrorMessage(error)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthShell :title="title" subtitle="Use pelo menos 8 caracteres.">
    <template v-if="!ready" />

    <template v-else-if="done">
      <AppAlert tone="success">
        Senha definida. As sessões abertas com a senha antiga foram encerradas. Entre com a nova
        senha.
      </AppAlert>
      <AppButton to="/entrar">Entrar</AppButton>
    </template>

    <template v-else-if="!token">
      <AppAlert tone="error">
        <p class="font-bold">Link incompleto.</p>
        <p>Abra de novo o link do e-mail ou peça um novo.</p>
      </AppAlert>
      <AppButton to="/esqueci-a-senha">Pedir um novo link</AppButton>
    </template>

    <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <AppTextField
        v-model="password"
        label="Nova senha"
        type="password"
        autocomplete="new-password"
        :error="errors.password"
      />
      <AppTextField
        v-model="confirmation"
        label="Repita a senha"
        type="password"
        autocomplete="new-password"
        :error="errors.confirmation"
      />
      <AppAlert v-if="formError" tone="error">
        {{ formError }}
        <NuxtLink
          v-if="tokenRejected"
          to="/esqueci-a-senha"
          class="mt-1 flex min-h-12 items-center font-bold underline underline-offset-4"
        >
          Pedir um novo link
        </NuxtLink>
      </AppAlert>
      <AppButton type="submit" :loading="submitting">Salvar senha</AppButton>
    </form>
  </AuthShell>
</template>
