<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'

/**
 * Painel de edição (Reka UI Dialog): tela cheia no celular, janela centralizada a partir
 * de 1024 px. Foco preso dentro, Esc fecha.
 */
withDefaults(defineProps<{ title: string; description?: string }>(), { description: undefined })
const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-text/40" />
      <DialogContent
        class="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg lg:inset-auto lg:top-1/2 lg:left-1/2 lg:max-h-[90dvh] lg:w-[min(720px,90vw)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-card lg:border lg:border-border"
      >
        <div class="flex items-center gap-2 border-b border-border bg-surface px-4 py-2">
          <DialogTitle class="flex-1 truncate font-display text-lg font-semibold">{{
            title
          }}</DialogTitle>
          <DialogClose
            class="flex size-12 items-center justify-center rounded-button text-text"
            aria-label="Fechar"
          >
            <AppIcon name="x" />
          </DialogClose>
        </div>
        <DialogDescription v-if="description" class="sr-only">{{ description }}</DialogDescription>
        <div class="flex-1 overflow-y-auto px-4 py-4">
          <slot />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
