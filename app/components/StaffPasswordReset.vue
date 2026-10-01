<script setup lang="ts">
import type { components } from '~/api/schema'
import { passwordError } from '~/lib/staff'

type ResetResponse = components['schemas']['StaffPasswordResetResponse']

/**
 * Senha do colaborador. RN-03.18: "Redefinir senha" gera um link de uso único (1 hora,
 * CA-03.08) com três formas de envio: e-mail (se houver), copiar link e WhatsApp
 * (`https://wa.me/?text=`). RN-03.19: o dono também define a senha direto. As duas encerram
 * as sessões do colaborador quando a senha muda.
 */
const props = defineProps<{ member: { id: string; name: string; email: string | null } }>()

const { $api } = useNuxtApp()
const resetAction = useApiAction()
const setAction = useApiAction()
const sendEmail = ref(!!props.member.email)
const issued = ref<ResetResponse | null>(null)

const mode = ref<'none' | 'link' | 'direct'>('none')
const password = ref('')
const passwordFieldError = ref('')
const passwordSaved = ref(false)

async function issueLink() {
  const result = await resetAction.run(() =>
    $api.POST('/api/v1/staff/{id}/password-reset', {
      params: { path: { id: props.member.id } },
      body: { sendEmail: !!props.member.email && sendEmail.value },
    }),
  )
  if (result.ok && result.data) issued.value = result.data
}

async function setPassword() {
  passwordSaved.value = false
  passwordFieldError.value = passwordError(password.value) ?? ''
  if (passwordFieldError.value) return
  const result = await setAction.run(() =>
    $api.PUT('/api/v1/staff/{id}/password', {
      params: { path: { id: props.member.id } },
      body: { password: password.value },
    }),
  )
  if (result.ok) {
    password.value = ''
    passwordSaved.value = true
  }
}
</script>

<template>
  <section class="flex flex-col gap-3" aria-labelledby="password-title">
    <h3 id="password-title" class="text-lg">Senha</h3>
    <div class="flex flex-wrap gap-2">
      <AppButton
        variant="secondary"
        :block="false"
        :aria-expanded="mode === 'link'"
        @click="mode = mode === 'link' ? 'none' : 'link'"
      >
        <AppIcon name="key" />
        Redefinir senha
      </AppButton>
      <AppButton
        variant="ghost"
        :block="false"
        :aria-expanded="mode === 'direct'"
        @click="mode = mode === 'direct' ? 'none' : 'direct'"
      >
        Definir uma senha agora
      </AppButton>
    </div>

    <div
      v-if="mode === 'link'"
      class="flex flex-col gap-3 rounded-card border border-border bg-surface-muted p-3"
    >
      <template v-if="!issued">
        <p>
          O Varal gera um link para {{ member.name }} criar uma senha nova. Ele vale por 1 hora e
          funciona uma única vez.
        </p>
        <AppCheckbox
          v-if="member.email"
          v-model="sendEmail"
          label="Enviar também por e-mail"
          :description="member.email"
        />
        <AppAlert v-else>Sem e-mail cadastrado: envie o link por WhatsApp ou copie.</AppAlert>
        <ErrorAlert :error="resetAction.error.value" />
        <AppButton variant="secondary" :loading="resetAction.busy.value" @click="issueLink">
          Gerar link
        </AppButton>
      </template>
      <template v-else>
        <AppAlert v-if="issued.emailSent" tone="success">
          Link enviado para {{ member.email }}.
        </AppAlert>
        <label class="flex flex-col gap-1.5">
          <span class="font-bold">Link de redefinição</span>
          <input
            :value="issued.link"
            readonly
            class="min-h-12 w-full rounded-button border-2 border-border-strong bg-surface px-3 text-sm"
            data-testid="reset-link"
            @focus="($event.target as HTMLInputElement).select()"
          />
        </label>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CopyButton :text="issued.link" />
          <a
            :href="issued.whatsappUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex min-h-12 items-center justify-center gap-2 rounded-button border-2 border-primary bg-surface px-5 font-bold text-primary-deep hover:bg-primary-soft"
          >
            <AppIcon name="message" />
            Enviar por WhatsApp
          </a>
        </div>
        <p class="text-sm text-text-muted">
          Gerar outro link invalida este. Limite de 3 links por hora.
        </p>
      </template>
    </div>

    <form
      v-if="mode === 'direct'"
      class="flex flex-col gap-3 rounded-card border border-border bg-surface-muted p-3"
      novalidate
      @submit.prevent="setPassword"
    >
      <AppTextField
        v-model="password"
        type="password"
        label="Nova senha"
        autocomplete="new-password"
        :hint="`Pelo menos 8 caracteres. ${member.name} sai de todos os aparelhos e entra com a senha nova.`"
        :error="passwordFieldError"
      />
      <ErrorAlert :error="setAction.error.value" />
      <AppAlert v-if="passwordSaved" tone="success">Senha definida.</AppAlert>
      <AppButton type="submit" variant="secondary" :loading="setAction.busy.value">
        Salvar senha
      </AppButton>
    </form>
  </section>
</template>
