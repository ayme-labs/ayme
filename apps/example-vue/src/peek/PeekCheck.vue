<script setup lang="ts">
import { ref } from "vue";
import { Button } from "@/components/ui/button";
import Counter from "./Counter.vue";

const visible = ref(true);
</script>

<!--
  The counter the shared Agent Connection suite reads through its Peek. Only
  the dev server renders it, and `ignore` keeps it out of Structural Page
  State, so the playground's tools and page state stay as they are.
-->
<template>
  <aside
    aria-label="Peek check"
    class="mt-6 flex flex-wrap items-center gap-3 rounded-xl border p-4"
    data-peek-check
  >
    <Button size="sm" variant="outline" @click="visible = !visible">
      {{ visible ? "Unmount counter" : "Mount counter" }}
    </Button>
    <Counter v-if="visible" />
  </aside>
</template>
