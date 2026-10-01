/**
 * Markdown simples dos comunicados (spec 02, RN-02.13 e RN-02.16).
 *
 * O texto vem do admin e é mostrado ao dono: nunca vira HTML cru (`v-html`). O parser
 * devolve uma árvore com poucos tipos de nó, que o `MarkdownView` desenha com elementos
 * do Vue (texto sempre escapado). Tudo que não for reconhecido aparece como texto.
 *
 * Suportado: parágrafos (linha simples quebra a linha), títulos `#`, `##`, `###`, listas
 * com `-`, `*`, `+` ou `1.`, **negrito**, *itálico*, `código` e [links](https://...) só
 * com `http:`, `https:` ou `mailto:`.
 */
export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: MarkdownInline[] }
  | { type: 'br' }

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][] }

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const ESCAPABLE = /[\\`*_[\]()#+\-.!]/

/** Endereço do link, se for de um protocolo seguro; `null` para o resto (`javascript:`…). */
export function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function parseInline(source: string): MarkdownInline[] {
  const out: MarkdownInline[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) out.push({ type: 'text', text: buffer })
    buffer = ''
  }

  let i = 0
  while (i < source.length) {
    const char = source[i] as string
    const next = source[i + 1]

    if (char === '\\' && next !== undefined && ESCAPABLE.test(next)) {
      buffer += next
      i += 2
      continue
    }
    if (char === '\n') {
      flush()
      out.push({ type: 'br' })
      i += 1
      continue
    }
    if (char === '`') {
      const end = source.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ type: 'code', text: source.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if ((char === '*' || char === '_') && next === char) {
      const marker = char + char
      const end = source.indexOf(marker, i + 2)
      if (end > i + 2) {
        flush()
        out.push({ type: 'strong', children: parseInline(source.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if ((char === '*' || char === '_') && next !== undefined && next !== ' ' && next !== char) {
      const end = source.indexOf(char, i + 1)
      if (end > i + 1 && source[end - 1] !== ' ') {
        flush()
        out.push({ type: 'em', children: parseInline(source.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    if (char === '[') {
      const match = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(source.slice(i))
      if (match) {
        flush()
        const label = parseInline(match[1] as string)
        const href = safeHref(match[2] as string)
        // Link com protocolo perigoso: fica só o texto, sem endereço.
        if (href) out.push({ type: 'link', href, children: label })
        else out.push(...label)
        i += match[0].length
        continue
      }
    }
    buffer += char
    i += 1
  }
  flush()
  return out
}

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/
const UNORDERED = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d{1,3}[.)]\s+(.*)$/

export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const closeParagraph = () => {
    if (paragraph.length)
      blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) })
    paragraph = []
  }
  const closeList = () => {
    if (list) {
      blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(parseInline) })
    }
    list = null
  }

  for (const line of lines) {
    if (!line.trim()) {
      closeParagraph()
      closeList()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      closeParagraph()
      closeList()
      const level = (heading[1] as string).length as 1 | 2 | 3
      blocks.push({ type: 'heading', level, children: parseInline(heading[2] as string) })
      continue
    }
    const unordered = UNORDERED.exec(line)
    const ordered = unordered ? null : ORDERED.exec(line)
    const item = unordered ?? ordered
    if (item) {
      closeParagraph()
      const isOrdered = ordered !== null
      if (list && list.ordered !== isOrdered) closeList()
      list ??= { ordered: isOrdered, items: [] }
      list.items.push(item[1] as string)
      continue
    }
    closeList()
    paragraph.push(line.trim())
  }
  closeParagraph()
  closeList()
  return blocks
}
