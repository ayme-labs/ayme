<script setup lang="ts">
import { ref } from "vue";
import { useAyme } from "@ayme-dev/vue";
import Counter from "./Counter.vue";

const visible = ref(true);
const { webMCP } = useAyme();
</script>

<template>
  <p role="status" aria-label="Publication">
    Publication: {{ webMCP.publicationStatus.state }}
  </p>
  <button @click="visible = !visible">
    {{ visible ? "Unmount counter" : "Mount counter" }}
  </button>
  <!-- A plain anchor: the browser loads /other as a new document. -->
  <a href="/other">Full page load</a>
  <Counter v-if="visible" />
</template>
