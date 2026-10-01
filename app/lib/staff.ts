import type { components } from '../api/schema'

type Schemas = components['schemas']
export type StaffPermissionInput = Schemas['StaffPermissionInputInput']
export type StaffMember = Schemas['StaffMember']

/** Regras de usuário e senha (spec 01, seção 7.3; RN-03.15). */
export const USERNAME_PATTERN = /^[A-Za-z0-9._]{3,32}$/
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

export function usernameError(username: string): string | null {
  if (!username.trim()) return 'Informe o usuário.'
  if (!USERNAME_PATTERN.test(username.trim())) {
    return 'Use de 3 a 32 letras, números, ponto ou sublinhado, sem espaços.'
  }
  return null
}

export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN)
    return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`
  if (password.length > PASSWORD_MAX) return `A senha pode ter até ${PASSWORD_MAX} caracteres.`
  return null
}

export function emailError(email: string): string | null {
  if (!email.trim()) return null
  return /^\S+@\S+\.\S+$/.test(email.trim()) ? null : 'Confira o e-mail.'
}

/** Permissões como a API devolve → corpo de `PUT /staff/{id}/permissions`. */
export function toPermissionInputs(
  member: Pick<StaffMember, 'permissions'>,
): StaffPermissionInput[] {
  return member.permissions.map((permission) => ({
    unitId: permission.unitId,
    stationIds: [...permission.stationIds],
    canOperateCash: permission.canOperateCash,
  }))
}

/** Resumo de uma permissão: "Barraca da Praça: Balcão, Cozinha · opera caixa". */
export function permissionSummary(permission: Schemas['StaffUnitPermission']): string {
  const stations = permission.stations.map((station) => station.name).join(', ')
  const parts = [stations || 'nenhuma estação']
  if (permission.canOperateCash) parts.push('opera caixa')
  return `${permission.unitName}: ${parts.join(' · ')}`
}
