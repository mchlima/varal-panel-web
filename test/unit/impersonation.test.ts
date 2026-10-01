import { describe, expect, it } from 'vitest'
import { impersonationErrorMessage } from '../../app/lib/impersonation'

describe('"entrar como" (spec 02, seção 7)', () => {
  it('erros da troca do link explicam o que aconteceu (RN-02.21)', () => {
    expect(impersonationErrorMessage(401, 'UNAUTHENTICATED', 'x')).toContain(
      'só funciona no navegador em que você está logado no admin',
    )
    expect(impersonationErrorMessage(400, 'INVALID_IMPERSONATION_TOKEN', 'x')).toContain(
      'já foi usado ou venceu',
    )
    expect(impersonationErrorMessage(429, 'RATE_LIMITED', 'Muitas tentativas.')).toBe(
      'Muitas tentativas.',
    )
  })
})
