<script setup lang="ts">
/**
 * Ícones de traço desenhados no próprio app (spec 08: nada de emoji como ícone).
 * Decorativos por padrão; passe `label` quando o ícone for a única informação.
 */
const props = withDefaults(defineProps<{ name: IconName; size?: number; label?: string }>(), {
  size: 20,
  label: undefined,
})

const paths = {
  'alert-circle': ['M12 8v5', 'M12 16.5v.01', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
  'check-circle': ['M8.5 12.5l2.5 2.5 5-5.5', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
  info: ['M12 11v5', 'M12 7.5v.01', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
  'wifi-off': [
    'M2 2l20 20',
    'M8.5 16.5a5 5 0 0 1 7 0',
    'M5 12.9a10 10 0 0 1 5.2-2.8',
    'M19 12.9a10 10 0 0 0-2.3-1.6',
    'M2 8.8a15 15 0 0 1 4.2-2.6',
    'M10.7 5.1A15 15 0 0 1 22 8.8',
    'M12 20h.01',
  ],
  wifi: [
    'M5 12.9a10 10 0 0 1 14 0',
    'M2 8.8a15 15 0 0 1 20 0',
    'M8.5 16.5a5 5 0 0 1 7 0',
    'M12 20h.01',
  ],
  refresh: [
    'M20 11a8 8 0 0 0-14.8-4.2L3 9',
    'M3 4v5h5',
    'M4 13a8 8 0 0 0 14.8 4.2L21 15',
    'M21 20v-5h-5',
  ],
  'log-out': ['M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3', 'M10 17l-5-5 5-5', 'M5 12h11'],
  share: [
    'M12 3v12',
    'M8 7l4-4 4 4',
    'M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1',
  ],
  'plus-square': [
    'M12 8v8',
    'M8 12h8',
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
  ],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 21h16'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],
  'eye-off': [
    'M3 3l18 18',
    'M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.4 3.3',
    'M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6',
    'M9.9 9.9a3 3 0 0 0 4.2 4.2',
  ],
  store: ['M4 10v10h16V10', 'M3 4h18l-1.5 6h-15L3 4Z', 'M9 20v-6h6v6'],
  'chevron-right': ['M9 6l6 6-6 6'],
  'arrow-left': ['M19 12H5', 'M11 6l-6 6 6 6'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  clock: ['M12 7v5l3 2', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
} as const

export type IconName = keyof typeof paths

const d = computed(() => paths[props.name])
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="shrink-0"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  >
    <path v-for="(path, i) in d" :key="i" :d="path" />
  </svg>
</template>
