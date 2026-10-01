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
  'chevrons-down': ['M7 6l5 5 5-5', 'M7 13l5 5 5-5'],
  'arrow-left': ['M19 12H5', 'M11 6l-6 6 6 6'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  clock: ['M12 7v5l3 2', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
  home: ['M3 11l9-8 9 8', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  menu: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3.5 6h.01', 'M3.5 12h.01', 'M3.5 18h.01'],
  users: [
    'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20',
    'M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    'M21 20v-1.5a4 4 0 0 0-3-3.9',
    'M15.5 4.1a3.5 3.5 0 0 1 0 6.8',
  ],
  qr: [
    'M4 4h6v6H4Z',
    'M14 4h6v6h-6Z',
    'M4 14h6v6H4Z',
    'M14 14h2v2h-2Z',
    'M18 14h2',
    'M14 18v2',
    'M18 18h2v2h-2Z',
  ],
  flow: [
    'M5 6h.01',
    'M5 12h.01',
    'M5 18h.01',
    'M9 6h10',
    'M9 12h10',
    'M9 18h10',
    'M5 7v4',
    'M5 13v4',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  'arrow-up': ['M12 19V5', 'M6 11l6-6 6 6'],
  'arrow-down': ['M12 5v14', 'M6 13l6 6 6-6'],
  grip: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  edit: ['M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z', 'M13.5 6.5l4 4'],
  copy: [
    'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z',
    'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  ],
  message: ['M4 5h16v11H9l-5 4V5Z'],
  mail: ['M3 6h18v12H3Z', 'M3 7l9 6 9-6'],
  key: ['M14.5 9.5a5 5 0 1 0-4 4.9', 'M10.5 14.4L3 22', 'M7 18l2 2', 'M15 9h.01'],
  ban: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M5.7 5.7l12.6 12.6'],
  power: ['M12 3v9', 'M6.3 6.3a8 8 0 1 0 11.4 0'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  station: ['M4 5h16v11H4Z', 'M9 20h6', 'M12 16v4'],
  flag: ['M5 21V4', 'M5 4h12l-2 4 2 4H5'],
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
