import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginForm from '~/components/LoginForm.vue'

describe('LoginForm (spec 01, seção 14)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('abre em "Sou dono" com e-mail e senha', async () => {
    const wrapper = await mountSuspended(LoginForm)
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['Sou dono', 'Sou colaborador'])
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('input[type="email"]').exists()).toBe(true)
  })

  it('CA-01.03: com o código do link, o colaborador digita só usuário e senha', async () => {
    const session = useSessionStore()
    const login = vi
      .spyOn(session, 'loginStaff')
      .mockResolvedValue({ ok: false, message: 'Código, usuário ou senha inválidos.' })

    const wrapper = await mountSuspended(LoginForm, {
      props: { initialTab: 'staff', accessCode: 'ESPT26', lockAccessCode: true },
    })
    expect(wrapper.text()).toContain('Código da barraca: ESPT26')
    const inputs = wrapper.findAll('input')
    expect(inputs).toHaveLength(2) // usuário e senha
    await inputs[0]!.setValue('ana')
    await inputs[1]!.setValue('varal12345')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(login).toHaveBeenCalledWith('ESPT26', 'ana', 'varal12345')
    // A mensagem da API (pt-BR) aparece na tela.
    expect(wrapper.find('[role="alert"]').text()).toContain('Código, usuário ou senha inválidos.')
  })

  it('valida campos obrigatórios antes de chamar a API', async () => {
    const session = useSessionStore()
    const login = vi.spyOn(session, 'loginOwner')
    const wrapper = await mountSuspended(LoginForm)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(login).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Informe o e-mail.')
    expect(wrapper.text()).toContain('Informe a senha.')
    expect(wrapper.find('input[type="email"]').attributes('aria-invalid')).toBe('true')
  })

  it('tem uma única ação principal (spec 08) e alvos de 48 px ou mais', async () => {
    const wrapper = await mountSuspended(LoginForm)
    const primary = wrapper.findAll('.bg-primary')
    expect(primary).toHaveLength(1)
    expect(primary[0]!.text()).toBe('Entrar')
    expect(primary[0]!.classes()).toContain('min-h-13')
    for (const tab of wrapper.findAll('[role="tab"]')) expect(tab.classes()).toContain('min-h-12')
  })
})
