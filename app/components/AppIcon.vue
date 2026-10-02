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
  dot: [
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
    'M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  ],
  bell: ['M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Z', 'M10 21h4'],
  'bell-off': ['M3 3l18 18', 'M8.3 5.3A6 6 0 0 1 18 11v4', 'M6 11v5l-2 2h12', 'M10 21h4'],
  more: ['M12 5.5v.01', 'M12 12v.01', 'M12 18.5v.01'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  minus: ['M5 12h14'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'M20 20l-4-4'],
  receipt: ['M6 3h12v18l-3-2-3 2-3-2-3 2V3Z', 'M9 8h6', 'M9 12h6', 'M9 16h3'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'M12 2v2',
    'M12 20v2',
    'M4.9 4.9l1.4 1.4',
    'M17.7 17.7l1.4 1.4',
    'M2 12h2',
    'M20 12h2',
    'M4.9 19.1l1.4-1.4',
    'M17.7 6.3l1.4-1.4',
  ],
  send: ['M4 12l16-8-6 16-2-6-8-2Z', 'M12 14l8-10'],
  'arrow-right': ['M5 12h14', 'M13 6l6 6-6 6'],
  calendar: ['M4 6h16v14H4Z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  /** Pix: losango de pontas abertas (sem a marca oficial). */
  pix: [
    'M12 3l4 4-4 4-4-4 4-4Z',
    'M12 13l4 4-4 4-4-4 4-4Z',
    'M3 12l4-4',
    'M3 12l4 4',
    'M21 12l-4-4',
    'M21 12l-4 4',
  ],
  cash: [
    'M3 7h18v10H3Z',
    'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
    'M6 10v.01',
    'M18 14v.01',
  ],
  card: ['M3 6h18v12H3Z', 'M3 10h18', 'M7 15h3'],
  wallet: ['M4 7h15a1 1 0 0 1 1 1v11H4Z', 'M4 7l11-3v3', 'M16 13h.01'],
  percent: [
    'M19 5L5 19',
    'M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    'M17 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  ],
  backspace: ['M8 5h12v14H8l-6-7 6-7Z', 'M12 9l5 6', 'M17 9l-5 6'],
  /** Relatórios: barras. */
  chart: ['M4 20h16', 'M7 16v-4', 'M12 16V6', 'M17 16v-7'],
  /** "Mais" do menu do painel: quatro quadrados. */
  grid: ['M4 4h6v6H4Z', 'M14 4h6v6h-6Z', 'M4 14h6v6H4Z', 'M14 14h6v6h-6Z'],
  /** Atenção (spec 08, seção 4): ampulheta. */
  hourglass: [
    'M6 3h12',
    'M6 21h12',
    'M7 3c0 5 10 5 10 9s-10 4-10 9',
    'M17 3c0 5-10 5-10 9s10 4 10 9',
  ],
  /** Aviso (comandas abertas há mais de 2 dias, caixa esquecido aberto). */
  'alert-triangle': ['M12 3l10 18H2L12 3Z', 'M12 10v4', 'M12 17.5v.01'],
  /** Tabela de preço. */
  tag: ['M3 12V4h8l10 10-8 8L3 12Z', 'M7.5 7.5h.01'],
  /** Evento contratado. */
  party: ['M4 20l4-12 8 8-12 4Z', 'M14 4v2', 'M18 8h2', 'M16.5 5.5l1.5-1.5', 'M10 6l.5 1'],
  /** Tela cheia e sair dela. */
  maximize: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  minimize: ['M9 4v5H4', 'M15 4v5h5', 'M9 20v-5H4', 'M15 20v-5h5'],
  /** Recentes: relógio com seta de voltar. */
  history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
  /** Tamanho do cartão. */
  columns: ['M4 4h7v16H4Z', 'M13 4h7v16h-7Z'],
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
