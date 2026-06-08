<script setup lang="ts">
import pkg from '../package.json'
</script>

<template>
  <RouterView />
  <!-- Floating Version Badge -->
  <div class="fixed bottom-3 right-3 z-50 bg-zinc-950/70 border border-white/10 backdrop-blur-md px-2.5 py-0.5 rounded-full text-[10px] font-medium text-zinc-400 select-none pointer-events-none tracking-wider shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
    v{{ pkg.version }}
  </div>
</template>


