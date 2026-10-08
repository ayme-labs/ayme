<script setup lang="ts">
import { ref } from "vue";
import { usePeek } from "@ayme-dev/vue";
import { Button } from "@/components/ui/button";

const count = ref(0);
usePeek({ count }, "counter");
</script>

<template>
  <section aria-label="Counter" class="flex items-center gap-3">
    <p class="text-sm">
      Count: <output>{{ count }}</output>
    </p>
    <Button size="sm" variant="outline" @click="count += 1">Increment</Button>
  </section>
</template>
