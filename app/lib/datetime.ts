/** Datas sempre exibidas no horário de Brasília (AGENTS.md, convenções de código). */
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const date = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** "01/10/2026, 13:47" */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso))
}

/** "01/10/2026" */
export function formatDate(iso: string): string {
  return date.format(new Date(iso))
}
