<script setup lang="ts">
import { computed } from "vue";
import { decisionEndpoint, type CustomTool } from "@ayme-dev/ayme";
import { useAyme } from "@ayme-dev/vue";
import { decisionEndpointPath } from "../../vite/decisionEndpointPath";
import { benchPath } from "./benchRouter";
import BenchIndex from "./BenchIndex.vue";
import DocumentsPage from "./DocumentsPage.vue";
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
/**
 * A Custom Tool whose effect is not in the Structural Page State: it marks
 * the element with a data attribute and an outline, which change nothing in
 * the page tree. For the bench goal whose end state the page never shows.
 */
const highlightPageStateRef: CustomTool = {
  name: "highlight_page_state_ref",
  description:
    "Highlight one element on the page for the user by drawing an outline around it. The highlight is not visible in the page structure.",
  async execute({ ref, element }) {
    (element as HTMLElement).dataset.highlighted = "true";
    (element as HTMLElement).style.outline = "3px solid orange";
    return { highlighted: ref };
  },
};

useAyme({
  customTools: [highlightPageStateRef],
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
  "bench/documents": DocumentsPage,
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
