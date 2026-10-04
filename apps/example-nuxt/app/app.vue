<script setup lang="ts">
import { AymeProvider } from "@ayme-dev/vue";
import CounterDemo from "./components/CounterDemo.vue";

const inspector = import.meta.dev;
</script>

<template>
  <main>
    <h1>Ayme Nuxt prototype</h1>
    <p>Server-rendered Vue, with Page Objects running in the browser.</p>
    <AymeProvider :webMCP="{ enabled: true }" :inspector="inspector">
      <CounterDemo />
    </AymeProvider>
  </main>
</template>
