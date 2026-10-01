import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import AppSelect from '~/components/AppSelect.vue'
import AppTextField from '~/components/AppTextField.vue'
import LoginForm from '~/components/LoginForm.vue'

/**
 * Clique perdido: se a mensagem de erro de um campo aparecer ou sumir mudando a altura do
 * formulário entre o toque (ou o mousedown) e o click, o botão de enviar sai do lugar e o clique
 * cai fora dele. O jsdom não calcula layout, então o teste compara a estrutura de tudo o que
 * fica antes do botão (os mesmos elementos, na mesma ordem; só o texto, o ícone e a cor da borda mudam)
 * e confere a altura mínima da linha do erro. O e2e (`test/e2e/access.spec.ts`) mede a posição.
 */
function layoutBeforeSubmit(wrapper: VueWrapper): string[] {
  const form = wrapper.get('form').element
  const button = wrapper.get('button[type="submit"]').element
  return (
    Array.from(form.querySelectorAll('*'))
      .filter((el) => el.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING)
      // O ícone do erro fica dentro da linha reservada, sem mudar a altura dela.
      .filter((el) => !el.closest('svg'))
      .map((el) => el.tagName)
  )
}

describe('campos validados com a linha do erro reservada', () => {
  it('o botão Entrar não muda de lugar ao errar, corrigir o campo e sair dele', async () => {
    const session = useSessionStore()
    vi.spyOn(session, 'loginOwner').mockResolvedValue({ ok: false, message: 'Falhou.' })
    const wrapper = await mountSuspended(LoginForm)
    const before = layoutBeforeSubmit(wrapper)

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const password = wrapper.get('input[autocomplete="current-password"]')
    expect(password.attributes('aria-invalid')).toBe('true')
    const errorId = password.attributes('aria-describedby')
    expect(wrapper.get(`#${errorId}`).text()).toBe('Informe a senha.')
    expect(layoutBeforeSubmit(wrapper)).toEqual(before)

    await wrapper.get('input[type="email"]').setValue('dono@varal.local')
    await password.setValue('varal12345')
    await password.trigger('blur')
    await flushPromises()
    // Sair do campo não esconde nada: a mensagem só muda no próximo envio.
    expect(layoutBeforeSubmit(wrapper)).toEqual(before)
  })

  it('sem erro, a linha fica vazia, reservada e fora do aria-describedby', async () => {
    const field = await mountSuspended(AppTextField, {
      props: { label: 'E-mail', modelValue: '', error: undefined },
    })
    const input = field.get('input')
    expect(input.attributes('aria-invalid')).toBeUndefined()
    expect(input.attributes('aria-describedby')).toBeUndefined()
    const line = field.get(`#${input.attributes('id')}-error`)
    expect(line.text()).toBe('')
    expect(line.classes()).toContain('min-h-lh')

    await field.setProps({ error: 'Informe o e-mail.' })
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.attributes('aria-describedby')).toBe(`${input.attributes('id')}-error`)
    expect(line.text()).toBe('Informe o e-mail.')
  })

  it('campo sem validação (sem `error` ligado) não ganha a linha vazia', async () => {
    const select = await mountSuspended(AppSelect, {
      props: { label: 'Tipo', modelValue: 'a', options: [{ value: 'a', label: 'A' }] },
    })
    expect(select.find(`#${select.get('select').attributes('id')}-error`).exists()).toBe(false)
    const text = await mountSuspended(() => h(AppTextField, { label: 'Nome', modelValue: '' }))
    expect(text.findAll('p')).toHaveLength(0)
  })
})
