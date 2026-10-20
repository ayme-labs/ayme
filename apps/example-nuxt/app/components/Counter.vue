<script setup lang="ts">
import { ref } from "vue";
import { usePageObject, usePeek } from "@ayme-dev/vue";
import { CounterPage } from "../../playwright/pom/CounterPage";
import { SubCounterPage } from "../../playwright/pom/SubCounterPage";

const count = ref(0);
// Registered here, not at setup: the counter's presence is this component's
// lifetime, which no URL states (the certification unmounts it on its page).
const pom = usePageObject(CounterPage);
usePageObject(SubCounterPage);
usePeek({ count }, "counter");
</script>

<template>
  <section aria-label="Counter">
    <p>
      Count: <output>{{ count }}</output>
    </p>
    <button @click="count += 1">Increment</button>
    <button @click="pom.increment()">Call Page Object</button>
  </section>
</template>
