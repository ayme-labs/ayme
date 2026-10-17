<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import listPage from "../../playwright/pom/ListPage.ts?raw";
import listItem from "../../playwright/pom/ListItem.ts?raw";
import archiveDialog from "../../playwright/pom/ArchiveDialog.ts?raw";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

const selected = ref<string>(files[0].name);
const html = ref("");

// Shiki's markup is styled by classes it is given here, since the app has no
// stylesheet of its own: line numbers, and the lines that make it a Page Object.
const lineClass =
  "inline-block w-full pr-6 before:inline-block before:w-11 before:pr-4 before:text-right before:text-muted-foreground/60 before:content-[counter(line)] before:[counter-increment:line]";
const aymeLineClass = "bg-accent shadow-[inset_2px_0_0_var(--ring)]";

let latest = 0;
watchEffect(async () => {
  const { code, lang } = files.find((f) => f.name === selected.value)!;
  const request = ++latest;
  const lines = code.trimEnd().split("\n");
  const rendered = (await highlighter).codeToHtml(lines.join("\n"), {
    lang,
    theme: "github-light",
    transformers: [
      {
        pre(node) {
          this.addClassToHast(
            node,
            "overflow-x-auto bg-transparent! py-4 [counter-reset:line]"
          );
        },
        line(node, line) {
          this.addClassToHast(node, lineClass);
          if (aymeLine.test(lines[line - 1]!))
            this.addClassToHast(node, aymeLineClass);
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
    <Tabs v-model="selected" class="mt-4 min-h-0 flex-1 gap-0">
      <TabsList
        aria-label="Files"
        class="mx-3 mb-3 max-w-[calc(100%-1.5rem)] justify-start overflow-x-auto sm:mx-5"
      >
        <TabsTrigger
          v-for="f in files"
          :key="f.name"
          :value="f.name"
          class="flex-none font-mono text-xs"
        >
          {{ f.name
          }}<span v-if="'note' in f" class="font-sans text-muted-foreground"
            >· {{ f.note }}</span
          >
        </TabsTrigger>
      </TabsList>
      <TabsContent
        v-for="f in files"
        :key="f.name"
        :value="f.name"
        class="min-h-0 overflow-y-auto border-t bg-muted/30 text-[13px] leading-relaxed"
      >
        <div v-html="html" />
      </TabsContent>
    </Tabs>
  </section>
</template>
