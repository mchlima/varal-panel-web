<script setup lang="ts">
import { emailError, toPermissionInputs, usernameError, type StaffMember } from '~/lib/staff'

/**
 * Colaborador existente (spec 03, seção 6): dados, permissões por unidade (RN-03.16), senha
 * (RN-03.18, RN-03.19) e situação. Desativar encerra as sessões na hora (RN-03.17).
 */
const props = defineProps<{ member: StaffMember }>()
const emit = defineEmits<{ changed: [] }>()

const { $api } = useNuxtApp()
const dataAction = useApiAction()
const permissionsAction = useApiAction()
const statusAction = useApiAction()

const form = reactive({
  name: props.member.name,
  username: props.member.username,
  email: props.member.email ?? '',
})
const errors = ref<{ name?: string; username?: string; email?: string }>({})
const dataSaved = ref(false)
const permissions = ref(toPermissionInputs(props.member))
const permissionsSaved = ref(false)

watch(
  () => props.member,
  (member) => {
    permissions.value = toPermissionInputs(member)
  },
)

async function saveData() {
  dataSaved.value = false
  errors.value = {}
  if (!form.name.trim()) errors.value.name = 'Informe o nome.'
  const username = usernameError(form.username)
  if (username) errors.value.username = username
  const email = emailError(form.email)
  if (email) errors.value.email = email
  if (Object.keys(errors.value).length) return
  const result = await dataAction.run(() =>
    $api.PATCH('/api/v1/staff/{id}', {
      params: { path: { id: props.member.id } },
      body: {
        name: form.name.trim(),
        username: form.username.trim(),
        email: form.email.trim() || null,
      },
    }),
  )
  if (result.ok) {
    dataSaved.value = true
    emit('changed')
  }
}

async function savePermissions() {
  permissionsSaved.value = false
  const result = await permissionsAction.run(() =>
    $api.PUT('/api/v1/staff/{id}/permissions', {
      params: { path: { id: props.member.id } },
      body: { units: permissions.value },
    }),
  )
  if (result.ok) {
    permissionsSaved.value = true
    emit('changed')
  }
}

async function setActive(active: boolean) {
  const result = await statusAction.run(() =>
    $api.PATCH('/api/v1/staff/{id}', {
      params: { path: { id: props.member.id } },
      body: { active },
    }),
  )
  if (result.ok) emit('changed')
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <form class="flex flex-col gap-3" novalidate aria-label="Dados" @submit.prevent="saveData">
      <h3 class="text-lg">Dados</h3>
      <AppTextField v-model="form.name" label="Nome" :error="errors.name" :maxlength="80" />
      <AppTextField
        v-model="form.username"
        label="Usuário"
        autocapitalize="none"
        hint="Usado para entrar, junto com o código da barraca."
        :error="errors.username"
        :maxlength="32"
      />
      <AppTextField
        v-model="form.email"
        type="email"
        label="E-mail (opcional)"
        autocapitalize="none"
        :error="errors.email"
      />
      <ErrorAlert :error="dataAction.error.value" />
      <AppAlert v-if="dataSaved" tone="success">Dados salvos.</AppAlert>
      <AppButton type="submit" variant="secondary" :loading="dataAction.busy.value">
        Salvar dados
      </AppButton>
    </form>

    <div class="flex flex-col gap-3">
      <h3 class="text-lg">Permissões</h3>
      <StaffPermissionsEditor v-model="permissions" />
      <ErrorAlert :error="permissionsAction.error.value" />
      <AppAlert v-if="permissionsSaved" tone="success">
        Permissões salvas. Os aparelhos de {{ member.name }} já usam as novas.
      </AppAlert>
      <AppButton
        variant="secondary"
        :loading="permissionsAction.busy.value"
        @click="savePermissions"
      >
        Salvar permissões
      </AppButton>
    </div>

    <StaffPasswordReset :member="member" />

    <section class="flex flex-col gap-3" aria-labelledby="status-title">
      <h3 id="status-title" class="text-lg">Situação</h3>
      <ErrorAlert :error="statusAction.error.value" />
      <ConfirmAction
        v-if="member.active"
        label="Desativar colaborador"
        :question="`Desativar ${member.name}?`"
        confirm-label="Desativar"
        :loading="statusAction.busy.value"
        @confirm="setActive(false)"
      >
        <template #icon><AppIcon name="power" /></template>
        <p>
          {{ member.name }} sai de todos os aparelhos na hora e não entra mais. O histórico continua
          com o nome dele.
        </p>
      </ConfirmAction>
      <AppButton
        v-else
        variant="secondary"
        :loading="statusAction.busy.value"
        @click="setActive(true)"
      >
        <AppIcon name="power" />
        Reativar colaborador
      </AppButton>
    </section>
  </div>
</template>
