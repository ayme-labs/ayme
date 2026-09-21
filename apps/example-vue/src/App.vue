<script setup lang="ts">
import { decisionEndpoint } from "@ayme-dev/webmcp";
import { useAymeWebMcp, usePageObject } from "@ayme-dev/webmcp-vue";
import { ListPage } from "../playwright/pom/ListPage";
import { decisionEndpointPath } from "../vite/decisionEndpointPath";
import { Badge } from "@/components/ui/badge";
import AgentPanel from "./AgentPanel.vue";
import { useDemoTrace } from "./ayme/useDemoTrace";
import ListDemo from "./demo/ListDemo.vue";

// Ordinary apps call useAymeWebMcp() without options. This demo adds tracing and pacing.
const { page } = useDemoTrace();
useAymeWebMcp({
  page,
  // Only the dev server mounts a Decision Endpoint, so the Goal Loop is a
  // development feature here and the deployed build publishes no pursue_goal.
  goalLoop: import.meta.env.DEV
    ? decisionEndpoint(decisionEndpointPath)
    : undefined,
});
usePageObject(ListPage);
</script>

<template>
  <div class="min-h-svh">
    <!--
      The right grid column is empty on purpose: it reserves the space the
      floating Ayme inspector occupies so the app never sits underneath it.
    -->
    <div
      class="mx-auto grid max-w-[90rem] items-start gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_34.5rem]"
    >
      <div class="min-w-0">
        <!--
          Site chrome is not part of the playground, so it borrows the
          inspector's host marker to stay out of Structural Page State. The
          agent wizard's dialog is teleported inside this element for the same
          reason. Demo-only stopgap until apps can exclude elements
          themselves: ayme-labs/ayme#74.
        -->
        <header class="mb-6" data-ayme-inspector-host>
          <p
            class="text-xs font-semibold tracking-widest text-muted-foreground uppercase"
          >
            Ayme WebMCP
          </p>
          <h1 class="mt-2 text-3xl font-semibold tracking-tight text-balance">
            Playground
          </h1>
          <p
            class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground"
          >
            A small list app whose Page Object actions are published as WebMCP
            tools. Try it here — from the inspector or your own coding agent —
            before adding Ayme WebMCP to your project.
          </p>
          <AgentPanel class="mt-5" />
        </header>

        <main
          aria-label="Playground"
          class="rounded-xl border bg-muted/40 p-4 sm:p-6"
        >
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p
              class="text-xs font-semibold tracking-widest text-muted-foreground uppercase"
            >
              Playground
            </p>
            <Badge variant="secondary">DOM-backed browser runtime</Badge>
          </div>
          <ListDemo />
        </main>
      </div>
    </div>
  </div>
</template>
