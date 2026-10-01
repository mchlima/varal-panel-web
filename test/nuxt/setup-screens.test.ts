import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { components } from '~/api/schema'
import ProductEditor from '~/components/ProductEditor.vue'
import SoldOutToggle from '~/components/SoldOutToggle.vue'
import SortableList from '~/components/SortableList.vue'
import StaffPasswordReset from '~/components/StaffPasswordReset.vue'
import WorkflowEditor from '~/components/WorkflowEditor.vue'
import type { Menu, MenuProduct } from '~/stores/menu'

type Schemas = components['schemas']

const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }))
mockNuxtImport('useOfflineQueue', () => () => ({
  available: true,
  enqueue,
  dismiss: vi.fn(),
  retryNow: vi.fn(),
}))

const UNIT = '0192f000-0000-7000-8000-0000000000f1'
const COUNTER = '0192f000-0000-7000-8000-0000000000c1'
const KITCHEN = '0192f000-0000-7000-8000-0000000000a1'
const DELIVERY = '0192f000-0000-7000-8000-0000000000a2'
const CATEGORY = '0192f000-0000-7000-8000-0000000000b1'
const PRODUCT = '0192f000-0000-7000-8000-0000000000d1'

const stations: Schemas['Station'][] = [
  { id: COUNTER, unitId: UNIT, name: 'Balcão', kind: 'counter', sortOrder: 1, active: true },
  { id: KITCHEN, unitId: UNIT, name: 'Cozinha', kind: 'queue', sortOrder: 2, active: true },
  {
    id: DELIVERY,
    unitId: UNIT,
    name: 'Balcão de entrega',
    kind: 'queue',
    sortOrder: 3,
    active: true,
  },
]

const workflow: Schemas['Workflow'] = {
  unitId: UNIT,
  version: 4,
  stages: [
    {
      id: 's1',
      name: 'Recebido',
      sortOrder: 1,
      target: 'product_station',
      stationId: null,
      isFinal: false,
    },
    {
      id: 's2',
      name: 'Preparando',
      sortOrder: 2,
      target: 'product_station',
      stationId: null,
      isFinal: false,
    },
    {
      id: 's3',
      name: 'Pronto',
      sortOrder: 3,
      target: 'fixed_station',
      stationId: DELIVERY,
      isFinal: false,
    },
    { id: 's4', name: 'Entregue', sortOrder: 4, target: 'none', stationId: null, isFinal: true },
  ],
}

function product(overrides: Partial<MenuProduct> = {}): MenuProduct {
  return {
    id: PRODUCT,
    unitId: UNIT,
    categoryId: CATEGORY,
    name: 'Espeto de carne',
    description: null,
    priceCents: 1200,
    stationId: null,
    prepStationId: KITCHEN,
    sortOrder: 1,
    active: true,
    soldOut: false,
    version: 3,
    modifierGroups: [],
    ...overrides,
  }
}

function menuWith(products: MenuProduct[]): Menu {
  return {
    unitId: UNIT,
    version: 7,
    categories: [
      {
        id: CATEGORY,
        unitId: UNIT,
        name: 'Espetos',
        sortOrder: 1,
        defaultStationId: KITCHEN,
        active: true,
        products,
      },
    ],
  }
}

/** Resposta no formato do openapi-fetch. */
function ok<T>(data: T, status = 200) {
  return Promise.resolve({ data, error: undefined, response: new Response(null, { status }) })
}
function fail(
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return Promise.resolve({
    data: undefined,
    error: { error: { code, message, details } },
    response: new Response(null, { status }),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('editor do fluxo (spec 03, seção 4.2)', () => {
  it('RN-03.05: mostra na hora o problema e não envia um fluxo sem etapa final', async () => {
    const put = vi.spyOn(useNuxtApp().$api, 'PUT')
    const wrapper = await mountSuspended(WorkflowEditor, {
      props: { unitId: UNIT, workflow, stations },
    })
    expect(wrapper.findAll('[data-testid="workflow-stages"] > li')).toHaveLength(4)
    const selects = wrapper.findAll('select')
    // Última etapa ("Onde o item aparece") deixa de ser final.
    await selects.at(-1)!.setValue('product_station')
    expect(wrapper.text()).toContain('O fluxo precisa terminar numa etapa final')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Salvar fluxo')!
      .trigger('click')
    await flushPromises()
    expect(put).not.toHaveBeenCalled()
  })

  it('RN-03.06: etapa com estação fixa só oferece estações de fila', async () => {
    const wrapper = await mountSuspended(WorkflowEditor, {
      props: { unitId: UNIT, workflow, stations },
    })
    const stationSelect = wrapper
      .findAll('select')
      .find((s) => s.text().includes('Escolha a estação'))!
    const labels = stationSelect.findAll('option').map((o) => o.text())
    expect(labels).toEqual(['Escolha a estação', 'Cozinha', 'Balcão de entrega'])
  })

  it('salva o fluxo inteiro com a versão e mostra os problemas de INVALID_WORKFLOW (CA-03.02)', async () => {
    const put = vi.spyOn(useNuxtApp().$api, 'PUT').mockImplementation(
      () =>
        fail(400, 'INVALID_WORKFLOW', 'O fluxo de etapas tem problemas. Confira e salve de novo.', {
          issues: [
            { code: 'STATION_NOT_QUEUE', index: 0, message: 'Precisa ser fila (servidor).' },
          ],
        }) as never,
    )
    const wrapper = await mountSuspended(WorkflowEditor, {
      props: { unitId: UNIT, workflow, stations },
    })
    await wrapper.find('input').setValue('Na fila')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Salvar fluxo')!
      .trigger('click')
    await flushPromises()
    expect(put).toHaveBeenCalledOnce()
    const [, options] = put.mock.calls[0] as unknown as [
      string,
      { body: Schemas['PutWorkflowRequestInput'] },
    ]
    expect(options.body.version).toBe(4)
    expect(options.body.stages.map((s) => s.name)).toEqual([
      'Na fila',
      'Preparando',
      'Pronto',
      'Entregue',
    ])
    expect(options.body.stages[0]!.id).toBe('s1')
    expect(wrapper.text()).toContain('Precisa ser fila (servidor).')
  })

  it('conflito de versão (409) oferece recarregar', async () => {
    vi.spyOn(useNuxtApp().$api, 'PUT').mockImplementation(
      () => fail(409, 'VERSION_CONFLICT', 'Outro aparelho alterou.') as never,
    )
    const wrapper = await mountSuspended(WorkflowEditor, {
      props: { unitId: UNIT, workflow, stations },
    })
    await wrapper.find('input').setValue('Na fila')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Salvar fluxo')!
      .trigger('click')
    await flushPromises()
    const reload = wrapper.findAll('button').find((b) => b.text() === 'Recarregar')
    expect(reload).toBeDefined()
    await reload!.trigger('click')
    expect(wrapper.emitted('reload')).toHaveLength(1)
  })
})

describe('lista ordenável (spec 03, seção 9)', () => {
  it('↑ e ↓ são a alternativa acessível ao arrasto e emitem a nova ordem', async () => {
    const items = [
      { id: 'a', name: 'Espetos' },
      { id: 'b', name: 'Porções' },
      { id: 'c', name: 'Bebidas' },
    ]
    const wrapper = await mountSuspended(SortableList, {
      props: {
        items,
        itemLabel: (item: { id: string }) => items.find((i) => i.id === item.id)!.name,
      },
    })
    expect(wrapper.find('[aria-label="Subir Espetos"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[aria-label="Subir Bebidas"]').trigger('click')
    expect(wrapper.emitted('reorder')).toEqual([[['a', 'c', 'b']]])
    expect(wrapper.text()).toContain('Bebidas na posição 2 de 3.')
    expect(wrapper.find('[aria-label="Arrastar Porções"]').exists()).toBe(true)
  })
})

describe('esgotado (RN-03.11, CA-03.05)', () => {
  it('marca pela fila offline com POST e mostra "Enviando…" até o servidor confirmar', async () => {
    enqueue.mockResolvedValue('key')
    const menu = useMenuStore()
    menu.unitId = UNIT
    menu.menu = menuWith([product()])
    const wrapper = await mountSuspended(SoldOutToggle, {
      props: { product: menu.findProduct(PRODUCT)! },
    })
    expect(wrapper.text()).toContain('Disponível')
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(enqueue).toHaveBeenCalledWith({
      method: 'POST',
      path: `/api/v1/products/${PRODUCT}/sold-out`,
      label: 'Marcar Espeto de carne como esgotado',
    })
    expect(menu.findProduct(PRODUCT)!.soldOut).toBe(true)
    await wrapper.setProps({ product: menu.findProduct(PRODUCT)! })
    expect(wrapper.text()).toContain('Esgotado')
    expect(wrapper.text()).toContain('Enviando…')
    expect(wrapper.find('button').attributes('aria-pressed')).toBe('true')

    // Evento do servidor confirma: a marca de envio some.
    menu.applySoldOut({
      type: 'product.sold_out_changed',
      organizationId: UNIT,
      unitId: UNIT,
      occurredAt: '',
      version: 4,
      data: { productId: PRODUCT, soldOut: true },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Enviando…')
  })

  it('ignora evento com versão menor ou igual à do produto', () => {
    const menu = useMenuStore()
    menu.unitId = UNIT
    menu.menu = menuWith([product({ version: 5 })])
    const event = (version: number, soldOut: boolean) => ({
      type: 'product.sold_out_changed' as const,
      organizationId: UNIT,
      unitId: UNIT,
      occurredAt: '',
      version,
      data: { productId: PRODUCT, soldOut },
    })
    menu.applySoldOut(event(5, true))
    expect(menu.findProduct(PRODUCT)!.soldOut).toBe(false)
    menu.applySoldOut(event(6, true))
    expect(menu.findProduct(PRODUCT)!.soldOut).toBe(true)
    expect(menu.findProduct(PRODUCT)!.version).toBe(6)
  })
})

describe('editor de produto (spec 03, seção 5)', () => {
  it('preço digitado em reais vai para a API em centavos (RN-03.09)', async () => {
    const menu = useMenuStore()
    menu.unitId = UNIT
    menu.menu = menuWith([])
    menu.stations = stations
    const post = vi
      .spyOn(useNuxtApp().$api, 'POST')
      .mockImplementation(() => ok({ ...product(), id: 'novo' }, 201) as never)
    vi.spyOn(menu, 'reload').mockResolvedValue()
    const wrapper = await mountSuspended(ProductEditor, {
      props: { unitId: UNIT, productId: null, categoryId: CATEGORY },
    })
    const inputs = wrapper.findAll('input[type="text"]')
    await inputs[0]!.setValue('Pão de alho')
    await inputs[2]!.setValue('7,50')
    // Estação de preparo: a da categoria, por padrão, com o nome dela.
    expect(wrapper.text()).toContain('Usar a da categoria (Cozinha)')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenCalledOnce()
    const [path, options] = post.mock.calls[0] as unknown as [
      string,
      { body: Schemas['CreateProductRequestInput']; params: { header: Record<string, string> } },
    ]
    expect(path).toBe('/api/v1/products')
    expect(options.body).toMatchObject({
      name: 'Pão de alho',
      priceCents: 750,
      categoryId: CATEGORY,
      stationId: null,
      active: true,
    })
    expect(options.params.header['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(wrapper.emitted('created')).toEqual([['novo']])
  })

  it('preço inválido não é enviado', async () => {
    const menu = useMenuStore()
    menu.menu = menuWith([])
    const post = vi.spyOn(useNuxtApp().$api, 'POST')
    const wrapper = await mountSuspended(ProductEditor, {
      props: { unitId: UNIT, productId: null, categoryId: CATEGORY },
    })
    const inputs = wrapper.findAll('input[type="text"]')
    await inputs[0]!.setValue('Kafta')
    await inputs[2]!.setValue('-3')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Informe o preço em reais')
  })
})

describe('redefinir senha do colaborador (RN-03.18, RN-03.19)', () => {
  it('gera o link e mostra as três opções: e-mail, copiar e WhatsApp', async () => {
    const post = vi.spyOn(useNuxtApp().$api, 'POST').mockImplementation(
      () =>
        ok({
          link: 'http://localhost:3100/definir-senha#token=abc&tipo=redefinicao',
          whatsappUrl: 'https://wa.me/?text=Ol%C3%A1',
          emailSent: true,
          expiresAt: '2026-10-01T15:00:00Z',
        }) as never,
    )
    const wrapper = await mountSuspended(StaffPasswordReset, {
      props: { member: { id: 'staff-1', name: 'Ana', email: 'ana@exemplo.com' } },
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Redefinir senha')!
      .trigger('click')
    expect(wrapper.text()).toContain('Enviar também por e-mail')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Gerar link')!
      .trigger('click')
    await flushPromises()
    const [, options] = post.mock.calls[0] as unknown as [string, { body: { sendEmail: boolean } }]
    expect(options.body.sendEmail).toBe(true)
    expect(wrapper.text()).toContain('Link enviado para ana@exemplo.com.')
    expect(
      (wrapper.find('[data-testid="reset-link"]').element as HTMLInputElement).value,
    ).toContain('/definir-senha#token=abc')
    expect(wrapper.text()).toContain('Copiar link')
    const whatsapp = wrapper.find('a[href^="https://wa.me/?text="]')
    expect(whatsapp.text()).toContain('Enviar por WhatsApp')
  })

  it('sem e-mail, não oferece o envio por e-mail', async () => {
    const wrapper = await mountSuspended(StaffPasswordReset, {
      props: { member: { id: 'staff-2', name: 'Bruno', email: null } },
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Redefinir senha')!
      .trigger('click')
    expect(wrapper.text()).not.toContain('Enviar também por e-mail')
    expect(wrapper.text()).toContain('Sem e-mail cadastrado')
  })

  it('RN-03.19: define a senha direto, com no mínimo 8 caracteres', async () => {
    const put = vi
      .spyOn(useNuxtApp().$api, 'PUT')
      .mockImplementation(() => ok(undefined, 204) as never)
    const wrapper = await mountSuspended(StaffPasswordReset, {
      props: { member: { id: 'staff-2', name: 'Bruno', email: null } },
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Definir uma senha agora')!
      .trigger('click')
    const input = wrapper.find('input[type="password"]')
    await input.setValue('curta')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(put).not.toHaveBeenCalled()
    await input.setValue('senha-nova-boa')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(put).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Senha definida.')
  })
})
