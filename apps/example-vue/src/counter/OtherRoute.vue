<script setup lang="ts">
import { AymeProvider } from "@ayme-dev/vue";
</script>

<!-- A page without Page Objects, which still runs Ayme's own tools. -->
<template>
  <main>
    <AymeProvider :webMCP="{ enabled: true }">
      <p>Other page without Page Objects.</p>
    </AymeProvider>
  </main>
</template>
