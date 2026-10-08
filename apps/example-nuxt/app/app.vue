<script setup lang="ts">
import { AymeProvider } from "@ayme-dev/vue";

const inspector = import.meta.dev;
const agentConnection = import.meta.dev;
</script>

<template>
  <main>
    <h1>Ayme Nuxt prototype</h1>
    <p>Server-rendered Vue, with Page Objects running in the browser.</p>
    <AymeProvider
      :webMCP="{ enabled: true }"
      :inspector="inspector"
      :agentConnection="agentConnection"
    >
      <NuxtPage />
    </AymeProvider>
  </main>
</template>
