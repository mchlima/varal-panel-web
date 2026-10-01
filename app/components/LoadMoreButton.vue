<script setup lang="ts">
/** Próxima página de uma lista por cursor (mesmo padrão do admin): botão de contorno, centrado. */
defineProps<{ loading: boolean }>()
defineEmits<{ click: [] }>()
</script>

<template>
  <div class="flex justify-center">
    <AppButton variant="secondary" :block="false" :loading="loading" @click="$emit('click')">
      <AppIcon v-if="!loading" name="chevrons-down" />
      Carregar mais
    </AppButton>
  </div>
</template>
