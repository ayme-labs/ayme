<script setup lang="ts">
import { ref } from "vue";

/**
 * A document list under a top bar whose Create button opens a small menu. The
 * button states whether its menu is open only through `aria-expanded`, so a
 * goal naming the open menu as its end state depends on the collapsed state.
 */
const documents = ["Quarterly report", "Meeting notes", "Roadmap"];
const menuOpen = ref(false);
</script>

<template>
  <main class="mx-auto grid max-w-2xl gap-6 p-8">
    <header class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Documents</h1>
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
    <ul aria-label="Documents" class="grid gap-2">
      <li v-for="name in documents" :key="name" class="rounded border p-3">
        {{ name }}
      </li>
    </ul>
  </main>
</template>
