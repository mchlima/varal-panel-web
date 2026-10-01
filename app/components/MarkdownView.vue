<script setup lang="ts">
import { h, type VNodeChild } from 'vue'
import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from '~/lib/markdown'

/**
 * Markdown simples dos comunicados (RN-02.13), desenhado com elementos do Vue a partir da
 * árvore de `parseMarkdown`: o texto é sempre escapado e nunca há `v-html`.
 */
const props = defineProps<{ source: string }>()

function inline(nodes: MarkdownInline[]): VNodeChild[] {
  return nodes.map((node) => {
    switch (node.type) {
      case 'text':
        return node.text
      case 'br':
        return h('br')
      case 'code':
        return h('code', { class: 'rounded-chip bg-surface-muted px-1' }, node.text)
      case 'strong':
        return h('strong', inline(node.children))
      case 'em':
        return h('em', inline(node.children))
      case 'link':
        return h(
          'a',
          {
            href: node.href,
            target: '_blank',
            rel: 'noopener noreferrer nofollow',
            class: 'font-bold text-primary-deep underline underline-offset-4',
          },
          inline(node.children),
        )
    }
  })
}

const headingTag = { 1: 'h3', 2: 'h4', 3: 'h5' } as const

function block(node: MarkdownBlock): VNodeChild {
  switch (node.type) {
    case 'heading':
      return h(
        headingTag[node.level],
        { class: 'font-display text-lg font-semibold' },
        inline(node.children),
      )
    case 'paragraph':
      return h('p', inline(node.children))
    case 'list':
      return h(
        node.ordered ? 'ol' : 'ul',
        { class: node.ordered ? 'list-decimal pl-6' : 'list-disc pl-6' },
        node.items.map((item) => h('li', inline(item))),
      )
  }
}

const Rendered = () =>
  h(
    'div',
    { class: 'flex flex-col gap-3', 'data-testid': 'markdown' },
    parseMarkdown(props.source).map(block),
  )
</script>

<template>
  <Rendered />
</template>
