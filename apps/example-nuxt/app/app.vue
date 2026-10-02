<script setup lang="ts">
import { AymeWebMcpProvider } from "@ayme-dev/vue";
import CounterDemo from "./components/CounterDemo.vue";
</script>

<template>
  <main>
    <h1>Ayme Nuxt prototype</h1>
    <p>Server-rendered Vue, with Page Objects running in the browser.</p>
    <AymeWebMcpProvider>
      <CounterDemo />
    </AymeWebMcpProvider>
  </main>
</template>
