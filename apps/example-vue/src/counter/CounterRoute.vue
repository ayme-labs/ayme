<script setup lang="ts">
import { AymeProvider } from "@ayme-dev/vue";
import CounterPageView from "./CounterPageView.vue";
</script>

<!--
  The counter page of the shared framework certification, which runs on
  `/counter`. It is separate from the playground and runs Ayme with
  publication on and nothing else.
-->
<template>
  <main>
    <h1>Ayme Vue counter</h1>
    <AymeProvider :webMCP="{ enabled: true }">
      <CounterPageView />
    </AymeProvider>
  </main>
</template>
