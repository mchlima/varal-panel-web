<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

/**
 * Login do app (spec 01, seções 7.1 e 14): abas "Sou dono" (e-mail e senha) e
 * "Sou colaborador" (código do estabelecimento, usuário e senha). Pelo link `/e/{codigo}`
 * o código já vem preenchido e o colaborador digita só usuário e senha (CA-01.03).
 */
export type LoginTab = 'owner' | 'staff'

const props = withDefaults(
  defineProps<{ initialTab?: LoginTab; accessCode?: string; lockAccessCode?: boolean }>(),
  { initialTab: 'owner', accessCode: '', lockAccessCode: false },
)

const session = useSessionStore()
const tab = ref<LoginTab>(props.initialTab)
const submitting = ref(false)
const formError = ref('')

const owner = reactive({ email: '', password: '' })
const staff = reactive({ accessCode: props.accessCode, username: '', password: '' })
type FieldErrors = Partial<
  Record<'email' | 'ownerPassword' | 'accessCode' | 'username' | 'staffPassword', string>
>
const errors = ref<FieldErrors>({})

watch(
  () => props.accessCode,
  (code) => {
    staff.accessCode = code
  },
)

watch(tab, () => {
  formError.value = ''
  errors.value = {}
})

function validate(): boolean {
  errors.value = {}
  const found: FieldErrors = {}
  if (tab.value === 'owner') {
    if (!owner.email.trim()) found.email = 'Informe o e-mail.'
    else if (!/^\S+@\S+\.\S+$/.test(owner.email.trim())) found.email = 'Confira o e-mail.'
    if (!owner.password) found.ownerPassword = 'Informe a senha.'
  } else {
    if (!staff.accessCode.trim()) found.accessCode = 'Informe o código da barraca.'
    if (!staff.username.trim()) found.username = 'Informe o usuário.'
    if (!staff.password) found.staffPassword = 'Informe a senha.'
  }
  errors.value = found
  return Object.keys(found).length === 0
}

async function submit() {
  formError.value = ''
  if (!validate()) return
  submitting.value = true
  const result =
    tab.value === 'owner'
      ? await session.loginOwner(owner.email, owner.password)
      : await session.loginStaff(staff.accessCode, staff.username, staff.password)
  submitting.value = false
  if (result.ok) {
    await navigateTo(session.homePath, { replace: true })
    return
  }
  formError.value = result.message ?? ''
}
</script>

<template>
  <TabsRoot v-model="tab" class="flex flex-col gap-5">
    <TabsList
      aria-label="Tipo de acesso"
      class="grid grid-cols-2 gap-1 rounded-card border border-border bg-surface p-1"
    >
      <TabsTrigger
        value="owner"
        class="min-h-12 rounded-button px-3 font-bold text-text-muted data-[state=active]:bg-primary-soft data-[state=active]:text-primary-deep"
      >
        Sou dono
      </TabsTrigger>
      <TabsTrigger
        value="staff"
        class="min-h-12 rounded-button px-3 font-bold text-text-muted data-[state=active]:bg-primary-soft data-[state=active]:text-primary-deep"
      >
        Sou colaborador
      </TabsTrigger>
    </TabsList>

    <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <TabsContent value="owner" class="flex flex-col gap-4">
        <AppTextField
          v-model="owner.email"
          label="E-mail"
          type="email"
          inputmode="email"
          autocomplete="username"
          autocapitalize="none"
          :error="errors.email"
        />
        <AppTextField
          v-model="owner.password"
          label="Senha"
          type="password"
          autocomplete="current-password"
          :error="errors.ownerPassword"
        />
      </TabsContent>

      <TabsContent value="staff" class="flex flex-col gap-4">
        <div v-if="lockAccessCode" class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-text-muted">
            Código da barraca: <strong class="text-text">{{ staff.accessCode }}</strong>
          </p>
          <NuxtLink
            to="/entrar?aba=colaborador"
            class="inline-flex min-h-12 items-center font-bold text-primary-deep underline underline-offset-4"
          >
            Usar outro código
          </NuxtLink>
        </div>
        <AppTextField
          v-else
          v-model="staff.accessCode"
          label="Código da barraca"
          hint="Seis letras e números, no QR code ou com o responsável."
          autocomplete="organization"
          autocapitalize="characters"
          :maxlength="16"
          :error="errors.accessCode"
        />
        <AppTextField
          v-model="staff.username"
          label="Usuário"
          autocomplete="username"
          autocapitalize="none"
          :error="errors.username"
        />
        <AppTextField
          v-model="staff.password"
          label="Senha"
          type="password"
          autocomplete="current-password"
          :error="errors.staffPassword"
        />
      </TabsContent>

      <AppAlert v-if="formError" tone="error">{{ formError }}</AppAlert>

      <AppButton type="submit" :loading="submitting">Entrar</AppButton>

      <AppButton v-if="tab === 'owner'" variant="ghost" to="/esqueci-a-senha">
        Esqueci a senha
      </AppButton>
      <p v-else class="text-center text-sm text-text-muted">
        Esqueceu a senha? Peça ao responsável pela barraca um link novo.
      </p>
    </form>
  </TabsRoot>
</template>
