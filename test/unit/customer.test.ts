import { describe, expect, it } from 'vitest'
import {
  customerBody,
  customerErrorField,
  customerLabel,
  emptyCustomerForm,
  formatCpf,
  formatPhone,
  homonymsWithoutIdentification,
  identificationLine,
  isValidCpf,
  isValidPhone,
  maskCpf,
  normalizePhone,
  receivableBlockMessage,
  sameName,
  validateCustomerForm,
} from '../../app/lib/customer'
import { formatCents } from '../../app/lib/money'
import { expectedSplit, splitLabel } from '../../app/lib/payment'

describe('telefone do cliente (RN-06.01)', () => {
  it('aceita celular e fixo com DDD, com ou sem pontuação e +55', () => {
    expect(isValidPhone('(11) 98765-4321')).toBe(true)
    expect(isValidPhone('11987654321')).toBe(true)
    expect(isValidPhone('+55 11 98765-4321')).toBe(true)
    expect(isValidPhone('(11) 3456-7890')).toBe(true)
  })

  it('recusa sem DDD, DDD inválido e celular sem o 9', () => {
    expect(isValidPhone('98765-4321')).toBe(false)
    expect(isValidPhone('(01) 98765-4321')).toBe(false)
    expect(isValidPhone('11 88765-43210')).toBe(false)
    expect(isValidPhone('11887654321')).toBe(false)
  })

  it('formata e normaliza só com dígitos', () => {
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321')
    expect(formatPhone('1134567890')).toBe('(11) 3456-7890')
    expect(normalizePhone('+55 (11) 98765-4321')).toBe('11987654321')
  })
})

describe('CPF do cliente (RN-06.01)', () => {
  it('valida pelos dígitos verificadores', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCpf('52998224725')).toBe(true)
    expect(isValidCpf('529.982.247-24')).toBe(false)
    expect(isValidCpf('111.111.111-11')).toBe(false)
    expect(isValidCpf('1234')).toBe(false)
  })

  it('formata e mascara na lista', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25')
    expect(maskCpf('52998224725')).toBe('***.***.247-25')
  })
})

describe('formulário de cliente (RN-06.01, CA-06.06)', () => {
  it('só o nome é obrigatório', () => {
    expect(validateCustomerForm(emptyCustomerForm('Seu Zé'))).toEqual({})
    expect(validateCustomerForm(emptyCustomerForm('  ')).name).toBe('Informe o nome do cliente.')
  })

  it('explica telefone e CPF inválidos e limites de tamanho', () => {
    const errors = validateCustomerForm({
      name: 'x'.repeat(61),
      phone: '1234',
      cpf: '123.456.789-00',
      reference: 'r'.repeat(61),
      note: 'n'.repeat(141),
    })
    expect(errors.name).toMatch(/60/)
    expect(errors.phone).toMatch(/DDD/)
    expect(errors.cpf).toMatch(/CPF inválido/)
    expect(errors.reference).toMatch(/60/)
    expect(errors.note).toMatch(/140/)
  })

  it('manda telefone e CPF só com dígitos e opcionais vazios como null', () => {
    expect(
      customerBody({
        name: '  Dona Cida ',
        phone: '(11) 98765-4321',
        cpf: '529.982.247-25',
        reference: ' ',
        note: '',
      }),
    ).toEqual({
      name: 'Dona Cida',
      phone: '11987654321',
      cpf: '52998224725',
      reference: null,
      note: null,
    })
  })

  it('telefone ou CPF repetido aparece no campo (CA-06.06)', () => {
    expect(customerErrorField('CUSTOMER_PHONE_TAKEN')).toBe('phone')
    expect(customerErrorField('CUSTOMER_CPF_TAKEN')).toBe('cpf')
    expect(customerErrorField('VALIDATION_FAILED')).toBeNull()
  })
})

describe('homônimos (RN-06.02, CA-06.06)', () => {
  const existing = [
    { id: 'a', name: 'José Silva' },
    { id: 'b', name: 'José Santos' },
  ]

  it('avisa ao cadastrar um nome que já existe sem dado de identificação', () => {
    expect(homonymsWithoutIdentification(emptyCustomerForm('jose  silva'), existing)).toEqual([
      existing[0],
    ])
  })

  it('não avisa quando o cadastro novo tem referência, telefone ou CPF', () => {
    const values = { ...emptyCustomerForm('José Silva'), reference: 'apto 42' }
    expect(homonymsWithoutIdentification(values, existing)).toEqual([])
    expect(
      homonymsWithoutIdentification(
        { ...emptyCustomerForm('José Silva'), phone: '11987654321' },
        existing,
      ),
    ).toEqual([])
  })

  it('compara nomes sem acento, caixa e espaços extras', () => {
    expect(sameName('Dona  Cida', 'dona cida')).toBe(true)
    expect(sameName('José', 'Jose')).toBe(true)
    expect(sameName('José', 'Josefa')).toBe(false)
  })

  it('mostra os dados de identificação na lista para diferenciar homônimos', () => {
    expect(
      identificationLine({
        reference: 'apto 42',
        phone: '11987654321',
        cpf: '52998224725',
        note: null,
      }),
    ).toBe('apto 42 · (11) 98765-4321 · CPF ***.***.247-25')
    expect(identificationLine({ phone: null, cpf: null, reference: null, note: null })).toBe('')
    expect(customerLabel({ name: 'Seu Zé', reference: 'barraca do lado' })).toBe(
      'Seu Zé (barraca do lado)',
    )
  })
})

describe('remoção de cliente com saldo (RN-06.03, CA-06.05)', () => {
  it('explica que o fiado precisa ser quitado antes', () => {
    expect(receivableBlockMessage(10_000, formatCents)).toMatch(/R\$\s100,00/)
    expect(receivableBlockMessage(null, formatCents)).toMatch(/Quite as comandas/)
  })
})

describe('conferência com quitações separadas (RN-05.22)', () => {
  it('separa vendas do turno e quitações de fiado por forma', () => {
    const register = {
      expected: [
        {
          method: 'pix' as const,
          expectedCents: 9_000,
          salesCents: 3_000,
          creditSettlementsCents: 6_000,
        },
      ],
    }
    expect(expectedSplit(register, 'pix')).toEqual({
      salesCents: 3_000,
      creditSettlementsCents: 6_000,
    })
    expect(expectedSplit(register, 'cash')).toEqual({ salesCents: 0, creditSettlementsCents: 0 })
    expect(splitLabel(expectedSplit(register, 'pix'))).toMatch(
      /vendas R\$\s30,00 · quitações de fiado R\$\s60,00/,
    )
  })
})
