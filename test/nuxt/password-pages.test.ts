import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DefinirSenha from '~/pages/definir-senha.vue'
import EsqueciASenha from '~/pages/esqueci-a-senha.vue'

function apiResponse(status: number, body?: unknown) {
  const response = new Response(body === undefined ? null : JSON.stringify(body), { status })
  return status < 400
    ? { data: body, response, error: undefined }
    : { data: undefined, response, error: body }
}

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('/definir-senha (spec 01, seção 7.4)', () => {
  it('lê token e tipo do fragmento e apaga o fragmento da URL', async () => {
    window.history.replaceState(
      null,
      '',
      '/definir-senha#token=tok_1234567890abcdefghij&tipo=convite',
    )
    const post = vi.spyOn(useNuxtApp().$api, 'POST').mockResolvedValue(apiResponse(204) as never)

    const wrapper = await mountSuspended(DefinirSenha)
    await flushPromises()
    expect(window.location.hash).toBe('')
    expect(wrapper.text()).toContain('Crie sua senha')

    const [password, confirmation] = wrapper.findAll('input')
    await password!.setValue('senha-nova-1')
    await confirmation!.setValue('senha-nova-1')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/v1/auth/password/reset', {
      body: { token: 'tok_1234567890abcdefghij', password: 'senha-nova-1' },
    })
    expect(wrapper.text()).toContain('Senha definida.')
  })

  it('exige 8 caracteres e confirmação igual', async () => {
    window.history.replaceState(
      null,
      '',
      '/definir-senha#token=tok_1234567890abcdefghij&tipo=redefinicao',
    )
    const post = vi.spyOn(useNuxtApp().$api, 'POST')
    const wrapper = await mountSuspended(DefinirSenha)
    await flushPromises()
    expect(wrapper.text()).toContain('Nova senha')

    const [password, confirmation] = wrapper.findAll('input')
    await password!.setValue('1234567')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('A senha precisa ter pelo menos 8 caracteres.')

    await password!.setValue('12345678')
    await confirmation!.setValue('12345679')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('As duas senhas não são iguais.')
    expect(post).not.toHaveBeenCalled()
  })

  it('token recusado mostra a mensagem da API e oferece um novo link', async () => {
    window.history.replaceState(
      null,
      '',
      '/definir-senha#token=tok_1234567890abcdefghij&tipo=redefinicao',
    )
    vi.spyOn(useNuxtApp().$api, 'POST').mockResolvedValue(
      apiResponse(400, {
        error: {
          code: 'INVALID_PASSWORD_TOKEN',
          message: 'Link inválido ou vencido.',
          details: {},
        },
      }) as never,
    )
    const wrapper = await mountSuspended(DefinirSenha)
    await flushPromises()
    const [password, confirmation] = wrapper.findAll('input')
    await password!.setValue('12345678')
    await confirmation!.setValue('12345678')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Link inválido ou vencido.')
    expect(wrapper.text()).toContain('Pedir um novo link')
  })

  it('sem token no link, explica e não mostra o formulário', async () => {
    window.history.replaceState(null, '', '/definir-senha')
    const wrapper = await mountSuspended(DefinirSenha)
    await flushPromises()
    expect(wrapper.text()).toContain('Link incompleto.')
    expect(wrapper.find('form').exists()).toBe(false)
  })
})

describe('/esqueci-a-senha (RN-01.03)', () => {
  it('mostra sempre a mesma mensagem depois do pedido', async () => {
    const post = vi
      .spyOn(useNuxtApp().$api, 'POST')
      .mockResolvedValue(apiResponse(202, { message: 'qualquer' }) as never)
    const texts: string[] = []
    for (const email of ['existe@varal.local', 'nao-existe@varal.local']) {
      const wrapper = await mountSuspended(EsqueciASenha)
      await wrapper.find('input').setValue(email)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      texts.push(wrapper.get('[role="status"]').text())
    }
    expect(post).toHaveBeenCalledTimes(2)
    expect(texts[0]).toContain('Se houver uma conta com esse e-mail')
    expect(texts[0]).toBe(texts[1])
  })

  it('erro da API (ex.: limite de pedidos) aparece com a mensagem dela', async () => {
    vi.spyOn(useNuxtApp().$api, 'POST').mockResolvedValue(
      apiResponse(429, {
        error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde.', details: {} },
      }) as never,
    )
    const wrapper = await mountSuspended(EsqueciASenha)
    await wrapper.find('input').setValue('dono@varal.local')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Muitas tentativas. Aguarde.')
  })
})
