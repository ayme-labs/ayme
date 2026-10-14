<script setup lang="ts">
import { computed } from "vue";
import { decisionEndpoint } from "@ayme-dev/ayme";
import { useAyme } from "@ayme-dev/vue";
import { decisionEndpointPath } from "../../vite/decisionEndpointPath";
import { benchPath } from "./benchRouter";
import BenchIndex from "./BenchIndex.vue";
import LoginPage from "./LoginPage.vue";
import NewProjectFlow from "./NewProjectFlow.vue";
import ProfilePage from "./ProfilePage.vue";
import ProjectsPage from "./ProjectsPage.vue";
import SettingsPage from "./SettingsPage.vue";

/**
 * The bench pages: generic app screens with no Page Objects and no Ayme
 * annotations, for the run harness's `bench` goal set. They run Ayme as an
 * app without Page Objects does, so the Goal Loop can only act through the
 * Browser Tools. The dev server serves them; the production build has none.
 */
useAyme({
  // As in the playground: `goal` only when the dev server mounted a Decision
  // Endpoint, which it does only with a model key.
  goalLoop: import.meta.env.AYME_DECISION_ENDPOINT
    ? decisionEndpoint(decisionEndpointPath)
    : undefined,
  webMCP: { enabled: true },
});

const pages: Record<string, typeof BenchIndex> = {
  "bench/login": LoginPage,
  "bench/profile": ProfilePage,
  "bench/settings": SettingsPage,
  "bench/projects": ProjectsPage,
  // One component for both screens of the flow, so its state survives the
  // client-side route change between them.
  "bench/new-project": NewProjectFlow,
  "bench/new-project/invite": NewProjectFlow,
};
const page = computed(() => pages[benchPath.value] ?? BenchIndex);
</script>

<template>
  <component :is="page" />
</template>
