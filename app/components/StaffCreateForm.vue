<script setup lang="ts">
import { emailError, passwordError, usernameError, type StaffPermissionInput } from '~/lib/staff'

/**
 * Cadastro de colaborador (RN-03.15): nome, usuário (único na organização, CA-03.07), senha
 * inicial, e-mail opcional e permissões por unidade (RN-03.16).
 */
const emit = defineEmits<{ saved: []; cancel: [] }>()
const { $api } = useNuxtApp()
const session = useSessionStore()
const action = useApiAction()
const idempotency = useIdempotencyKey()

const form = reactive({ name: '', username: '', password: '', email: '' })
const errors = ref<{ name?: string; username?: string; password?: string; email?: string }>({})
// Com uma unidade só, ela já vem liberada (falta só escolher as estações).
const permissions = ref<StaffPermissionInput[]>(
  session.me?.units.length === 1
    ? [{ unitId: session.me.units[0]!.id, stationIds: [], canOperateCash: false }]
    : [],
)

async function save() {
  errors.value = {}
  if (!form.name.trim()) errors.value.name = 'Informe o nome.'
  const username = usernameError(form.username)
  if (username) errors.value.username = username
  const password = passwordError(form.password)
  if (password) errors.value.password = password
  const email = emailError(form.email)
  if (email) errors.value.email = email
  if (Object.keys(errors.value).length) return
  const body = {
    name: form.name.trim(),
    username: form.username.trim(),
    password: form.password,
    email: form.email.trim() || null,
    permissions: permissions.value,
  }
  const result = await action.run(() =>
    $api.POST('/api/v1/staff', {
      params: { header: { 'Idempotency-Key': idempotency.keyFor(body) } },
      body,
    }),
  )
  if (result.ok) {
    idempotency.reset()
    emit('saved')
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="save">
    <AppTextField v-model="form.name" label="Nome" :error="errors.name" :maxlength="80" />
    <AppTextField
      v-model="form.username"
      label="Usuário"
      autocapitalize="none"
      hint="Letras, números, ponto ou sublinhado. Ex.: ana, joao.silva."
      :error="errors.username"
      :maxlength="32"
    />
    <AppTextField
      v-model="form.password"
      type="password"
      label="Senha inicial"
      autocomplete="new-password"
      hint="Pelo menos 8 caracteres. Combine com a pessoa; ela pode trocar depois."
      :error="errors.password"
    />
    <AppTextField
      v-model="form.email"
      type="email"
      label="E-mail (opcional)"
      autocapitalize="none"
      hint="Serve para receber o link quando precisar redefinir a senha."
      :error="errors.email"
    />
    <StaffPermissionsEditor v-model="permissions" />
    <ErrorAlert :error="action.error.value" />
    <AppButton type="submit" :loading="action.busy.value">Cadastrar colaborador</AppButton>
    <AppButton variant="ghost" @click="emit('cancel')">Cancelar</AppButton>
  </form>
</template>
