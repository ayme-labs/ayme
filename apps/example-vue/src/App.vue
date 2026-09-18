<script setup lang="ts">
import { useAymeWebMcp, usePageObject } from "@ayme-dev/webmcp-vue";
import { ListPage } from "../playwright/pom/ListPage";
import { Badge } from "@/components/ui/badge";
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
  <div class="min-h-svh bg-muted/50">
    <!--
      The right grid column is empty on purpose: it reserves the space the
      floating Ayme inspector occupies so the app never sits underneath it.
    -->
    <div
      class="mx-auto grid max-w-[90rem] items-start gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_34.5rem]"
    >
      <div class="min-w-0">
        <header class="mb-6">
          <p
            class="text-xs font-semibold tracking-widest text-muted-foreground uppercase"
          >
            Ayme browser experiment
          </p>
          <div class="mt-2 flex flex-wrap items-start justify-between gap-3">
            <h1 class="text-3xl font-semibold tracking-tight text-balance">
              List app + WebMCP inspector
            </h1>
            <Badge variant="secondary">DOM-backed browser runtime</Badge>
          </div>
          <p
            class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground"
          >
            Operate the list directly on the left, or invoke the same generated
            POM tools from the debug console on the right. Hover an application
            model member to preview its live element, or click to select it.
          </p>
        </header>

        <main><ListDemo /></main>
      </div>
    </div>
  </div>
</template>
