<script setup lang="ts">
import { AymeProvider } from "@ayme-dev/vue";

// The certification pairs a coding agent with the page, in dev only.
const dev = import.meta.env.DEV;
</script>

<!-- A page without Page Objects, which still runs Ayme's own tools. -->
<template>
  <main>
    <AymeProvider :webMCP="{ enabled: true }" :agentConnection="dev">
      <p>Other page without Page Objects.</p>
    </AymeProvider>
  </main>
</template>
