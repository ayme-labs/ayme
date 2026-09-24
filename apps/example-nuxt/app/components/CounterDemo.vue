<script setup lang="ts">
import { ref } from "vue";
import { useAymeWebMcp } from "@ayme-dev/webmcp-vue";
import Counter from "./Counter.vue";

const visible = ref(true);
const { publicationStatus } = useAymeWebMcp();
</script>

<template>
  <p role="status" aria-label="Publication">
    Publication: {{ publicationStatus.state }}
  </p>
  <button @click="visible = !visible">
    {{ visible ? "Unmount counter" : "Mount counter" }}
  </button>
  <Counter v-if="visible" />
</template>
