<script setup lang="ts">
import { ref } from "vue";
import { usePageObject, usePeek } from "@ayme-dev/vue";
import { CounterPage } from "../../playwright/pom/CounterPage";
import { SubCounterPage } from "../../playwright/pom/SubCounterPage";

const count = ref(0);
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
