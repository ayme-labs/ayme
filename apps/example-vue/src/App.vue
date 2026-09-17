<script setup lang="ts">
import { useAymeWebMcp, usePageObject } from "@ayme-dev/webmcp-vue";
import { ListPage } from "../playwright/pom/ListPage";
import { useDemoRelay } from "./ayme/useDemoRelay";
import { useDemoTrace } from "./ayme/useDemoTrace";
import ListDemo from "./demo/ListDemo.vue";

// Ordinary apps call useAymeWebMcp() without options. This demo adds tracing and pacing.
const { page } = useDemoTrace();
const { publicationStatus } = useAymeWebMcp({ page });
useDemoRelay(publicationStatus);
usePageObject(ListPage);
</script>

<template>
  <div class="app-shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">Ayme browser experiment</p>
        <h1>List app + WebMCP inspector</h1>
        <p class="page-intro">
          Operate the list directly on the left, or invoke the same generated
          POM tools from the debug console on the right. Hover an application
          model member to preview its live element, or click to select it.
        </p>
      </div>
      <span class="runtime-badge">DOM-backed browser runtime</span>
    </header>

    <main class="app-layout"><ListDemo /></main>
  </div>
</template>
