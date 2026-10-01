<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'

/**
 * "Esqueci a senha" do dono (spec 01, seção 7.4). A resposta é sempre a mesma, exista
 * ou não o e-mail (RN-01.03): a tela não revela quem tem conta.
 */
useHead({ title: 'Esqueci a senha · Varal' })

const SENT_MESSAGE =
  'Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha. Ele vale por 1 hora. Confira também a caixa de spam.'

const { $api } = useNuxtApp()
const email = ref('')
const fieldError = ref('')
const formError = ref('')
const submitting = ref(false)
const sent = ref(false)

async function submit() {
  fieldError.value = ''
  formError.value = ''
  const value = email.value.trim().toLowerCase()
  if (!value) fieldError.value = 'Informe o e-mail.'
  else if (!/^\S+@\S+\.\S+$/.test(value)) fieldError.value = 'Confira o e-mail.'
  if (fieldError.value) return

  submitting.value = true
  try {
    const { error, response } = await $api.POST('/api/v1/auth/password/forgot', {
      body: { email: value },
    })
    // Validação, limite de pedidos ou erro do servidor: mostra o motivo.
    // Qualquer resposta de sucesso mostra a mesma mensagem (RN-01.03).
    if (response.ok) sent.value = true
    else formError.value = apiErrorMessage(error)
  } catch (error) {
    formError.value = apiErrorMessage(error)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthShell
    title="Esqueci a senha"
    subtitle="Para donos. Colaboradores pedem um link novo ao responsável pela barraca."
  >
    <template v-if="sent">
      <AppAlert tone="success">{{ SENT_MESSAGE }}</AppAlert>
      <AppButton to="/entrar">Voltar para o login</AppButton>
    </template>
    <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <AppTextField
        v-model="email"
        label="E-mail da conta"
        type="email"
        inputmode="email"
        autocomplete="email"
        autocapitalize="none"
        :error="fieldError"
      />
      <AppAlert v-if="formError" tone="error">{{ formError }}</AppAlert>
      <AppButton type="submit" :loading="submitting">Enviar link</AppButton>
      <AppButton variant="ghost" to="/entrar">
        <AppIcon name="arrow-left" />
        Voltar para o login
      </AppButton>
    </form>
  </AuthShell>
</template>
