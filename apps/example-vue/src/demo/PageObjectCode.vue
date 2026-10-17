<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import listPage from "../../playwright/pom/ListPage.ts?raw";
import listItem from "../../playwright/pom/ListItem.ts?raw";
import archiveDialog from "../../playwright/pom/ArchiveDialog.ts?raw";

// The Page Object files are shown as they are in the repository; the
// verifier in scripts/verify-browser-output.mjs names the same files. The
// wiring is App.vue as the Vue guide sets it up, not with the playground's
// own options; the closing tag is split so the SFC compiler doesn't end this
// block at it.
const wiring = `<script setup lang="ts">
import { useAyme, usePageObject } from "@ayme-dev/vue";
import { ListPage } from "../playwright/pom/ListPage";

useAyme({
  inspector: import.meta.env.DEV,
  agentConnection: import.meta.env.DEV,
});
usePageObject(ListPage);
</${"script"}>`;

const files = [
  { name: "ListPage.ts", lang: "typescript", code: listPage },
  { name: "ListItem.ts", lang: "typescript", code: listItem },
  { name: "ArchiveDialog.ts", lang: "typescript", code: archiveDialog },
  { name: "App.vue", lang: "vue", code: wiring, note: "wiring" },
] as const;

const highlighter = createHighlighterCore({
  themes: [import("shiki/themes/github-light.mjs")],
  langs: [import("shiki/langs/typescript.mjs"), import("shiki/langs/vue.mjs")],
  engine: createJavaScriptRegexEngine(),
});

/** The lines that make a class a Page Object, an action a tool, or wire it in. */
const aymeLine = /^\s*(@ayme\b|useAyme\(|usePageObject\()/;

const selected = ref(0);
const file = computed(() => files[selected.value]!);
const html = ref("");

let latest = 0;
watchEffect(async () => {
  const { code, lang } = file.value;
  const request = ++latest;
  const lines = code.trimEnd().split("\n");
  const rendered = (await highlighter).codeToHtml(lines.join("\n"), {
    lang,
    theme: "github-light",
    transformers: [
      {
        line(node, line) {
          if (aymeLine.test(lines[line - 1]!))
            this.addClassToHast(node, "ayme-line");
        },
      },
    ],
  });
  // A slower earlier file doesn't overwrite the one chosen since.
  if (request === latest) html.value = rendered;
});
</script>

<template>
  <section
    aria-label="Page Object code"
    class="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
  >
    <p class="max-w-xl px-4 pt-4 text-sm text-muted-foreground sm:px-6">
      The Playwright Page Objects behind this list. Each
      <code class="rounded bg-muted px-1 py-0.5 text-xs text-foreground"
        >@ayme.action</code
      >
      method becomes a tool you can run from the inspector.
    </p>
    <div
      role="tablist"
      aria-label="Files"
      class="mt-4 flex gap-1 overflow-x-auto border-b px-3 sm:px-5"
    >
      <button
        v-for="(f, index) in files"
        :id="`page-object-file-${index}`"
        :key="f.name"
        role="tab"
        type="button"
        :aria-selected="index === selected"
        aria-controls="page-object-code"
        class="-mb-px shrink-0 border-b-2 px-2.5 py-2 font-mono text-xs transition-colors"
        :class="
          index === selected
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        @click="selected = index"
      >
        {{ f.name
        }}<span
          v-if="'note' in f"
          class="ml-1.5 font-sans text-muted-foreground"
          >· {{ f.note }}</span
        >
      </button>
    </div>
    <div
      id="page-object-code"
      role="tabpanel"
      :aria-labelledby="`page-object-file-${selected}`"
      class="code min-h-0 flex-1 overflow-y-auto bg-muted/30 text-[13px] leading-relaxed"
      v-html="html"
    />
  </section>
</template>

<style scoped>
.code :deep(pre) {
  background: transparent !important;
  padding: 1rem 0;
  overflow-x: auto;
  counter-reset: line;
}
.code :deep(.line) {
  display: inline-block;
  width: 100%;
  padding-right: 1.5rem;
}
.code :deep(.line)::before {
  counter-increment: line;
  content: counter(line);
  display: inline-block;
  width: 2.75rem;
  padding-right: 1rem;
  text-align: right;
  color: var(--muted-foreground);
  opacity: 0.6;
}
.code :deep(.ayme-line) {
  background: oklch(0.95 0.04 250);
  box-shadow: inset 2px 0 0 oklch(0.6 0.15 250);
}
</style>
