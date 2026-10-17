<script setup lang="ts">
import { defineAsyncComponent, ref, useTemplateRef } from "vue";
import { decisionEndpoint } from "@ayme-dev/ayme";
import { useAyme, usePageObject } from "@ayme-dev/vue";
import { ListPage } from "../playwright/pom/ListPage";
import { decisionEndpointPath } from "../vite/decisionEndpointPath";
import AgentPanel from "./AgentPanel.vue";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import ListDemo from "./demo/ListDemo.vue";
import PeekCheck from "./peek/PeekCheck.vue";

// The highlighter loads with the code view, not with the app.
const PageObjectCode = defineAsyncComponent(
  () => import("./demo/PageObjectCode.vue")
);

// Ordinary apps call useAyme() without options. This demo keeps its site
// chrome and the dev server's Peek check out of Structural Page State.
const isNotPlayground = (element: Element) =>
  element.matches("[data-site-chrome], [data-peek-check]");
const peekCheck = import.meta.env.DEV;
// `VITE_AGENT_CONNECTION=false` builds the playground without the agent
// wizard or the Agent Connection, while `@ayme-dev/mcp` is not on npm yet.
const agentConnection = import.meta.env.VITE_AGENT_CONNECTION !== "false";
useAyme({
  ignore: isNotPlayground,
  // Only the dev server mounts a Decision Endpoint, and only when it has a
  // model key, so the page publishes `goal` only then: never in the deployed
  // build, nor on a dev server started without a key.
  goalLoop: import.meta.env.AYME_DECISION_ENDPOINT
    ? decisionEndpoint(decisionEndpointPath)
    : undefined,
  webMCP: { enabled: true },
  // The hosted playground shows the Inspector in demo mode, so visitors can
  // follow each action, and lets a visitor's coding agent connect;
  // `--mode inspector-disabled` builds it without either.
  inspector: import.meta.env.MODE !== "inspector-disabled" && { demo: true },
  agentConnection:
    agentConnection && import.meta.env.MODE !== "inspector-disabled",
});
usePageObject(ListPage);

// The app and its Page Object code sit side by side in a strip that
// scrolls sideways, and the switch scrolls it. The app stays on the page
// while the code shows, a scroll away, so the inspector and agents can still
// reach it, and acting on it scrolls it back into view.
type View = "app" | "code";
const view = ref<View>("app");
const codeOpened = ref(false);
const panes = useTemplateRef("panes");

function show(next: View) {
  view.value = next;
  if (next === "code") codeOpened.value = true;
  // Only the switch slides: a smooth scroll in CSS would also slow the
  // scroll Playwright makes before acting on the app.
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  panes.value?.scrollTo({
    left: next === "code" ? panes.value.scrollWidth : 0,
    behavior: still ? "instant" : "smooth",
  });
}

// Follows the strip where it comes to rest, at one end or the other, so a
// slide in progress doesn't flip the switch midway.
function followScroll() {
  const strip = panes.value!;
  // A swipe reaches the code without the switch, so it loads it too.
  if (strip.scrollLeft > 0) codeOpened.value = true;
  if (strip.scrollLeft <= 0) view.value = "app";
  else if (strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 1)
    view.value = "code";
}
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
          Site chrome is not part of the playground, so `ignore` keeps it out
          of Structural Page State. The agent wizard's dialog is teleported
          inside this element for the same reason.
        -->
        <header class="mb-6" data-site-chrome>
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
            tools.
            <template v-if="agentConnection">
              Try it here — from the inspector or your own coding agent — before
              adding Ayme WebMCP to your project.
            </template>
            <template v-else>
              Try it here from the inspector before adding Ayme WebMCP to your
              project.
            </template>
          </p>
          <AgentPanel v-if="agentConnection" class="mt-5" />
        </header>

        <main
          aria-label="Playground"
          class="rounded-xl border bg-muted/40 p-4 sm:p-6"
        >
          <div
            class="mb-4 flex flex-wrap items-center justify-between gap-3"
            data-site-chrome
          >
            <p
              class="text-xs font-semibold tracking-widest text-muted-foreground uppercase"
            >
              Playground
            </p>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-label="View"
              :model-value="view"
              @update:model-value="(next) => next && show(next as View)"
            >
              <ToggleGroupItem value="app">App</ToggleGroupItem>
              <ToggleGroupItem value="code">Page Object code</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div
            ref="panes"
            class="grid snap-x snap-mandatory auto-cols-[100%] grid-flow-col gap-6 overflow-x-auto [scrollbar-width:none]"
            @scroll="followScroll"
          >
            <ListDemo class="snap-start" />
            <!-- As tall as the app: the code scrolls inside it. -->
            <div class="relative snap-start" data-site-chrome>
              <PageObjectCode v-if="codeOpened" class="absolute inset-0" />
            </div>
          </div>
        </main>
        <PeekCheck v-if="peekCheck" />
      </div>
    </div>
  </div>
</template>
