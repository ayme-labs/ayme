<script setup lang="ts">
import { ref } from "vue";
import { decisionEndpoint } from "@ayme-dev/ayme";
import { useAyme } from "@ayme-dev/vue";
import { TopBar } from "../../playwright/pom/TopBar";
import { decisionEndpointPath } from "../../vite/decisionEndpointPath";

/**
 * The run harness's reproduction of issue 1059: a top bar whose Create button
 * opens a menu, with the `TopBar` Page Object registered. The dev server
 * serves it; the production build has none.
 */
useAyme({
  pageObjects: [TopBar],
  // As in the playground: `goal` only when the dev server mounted a Decision
  // Endpoint, which it does only with a model key.
  goalLoop: import.meta.env.AYME_DECISION_ENDPOINT
    ? decisionEndpoint(decisionEndpointPath)
    : undefined,
  webMCP: { enabled: true },
});

const menuOpen = ref(false);
</script>

<template>
  <header class="flex items-center justify-between border-b p-4">
    <span class="font-semibold">Workspace</span>
    <div class="relative">
      <button
        type="button"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        aria-controls="create-menu"
        class="rounded bg-primary px-3 py-1 text-primary-foreground"
        @click="menuOpen = !menuOpen"
      >
        Create
      </button>
      <ul
        v-if="menuOpen"
        id="create-menu"
        role="menu"
        aria-label="Create"
        class="absolute right-0 mt-1 grid rounded border bg-background p-1"
      >
        <li role="none">
          <button type="button" role="menuitem" class="px-2 py-1">
            New document
          </button>
        </li>
        <li role="none">
          <button type="button" role="menuitem" class="px-2 py-1">
            New folder
          </button>
        </li>
      </ul>
    </div>
  </header>
  <main class="mx-auto max-w-2xl p-8">
    <h1 class="text-2xl font-semibold">Documents</h1>
  </main>
</template>
