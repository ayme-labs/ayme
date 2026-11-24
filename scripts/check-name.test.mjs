import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { capitalizedNames, checkName } from "./check-name.mjs";

const passes = {
  "identifiers and longer words": [
    "a.ts",
    `import type { Ayme } from "@ayme-dev/ayme";\nconst _Ayme = inMemoryAymeStore as Ayme["tools"];\nclass AymeProvider { #Ayme = 1; }\n`,
  ],
  "an identifier in a Vue script": [
    "a.vue",
    `<script setup lang="ts">\nconst ayme: Ayme = use();\n</script>\n`,
  ],
  "an identifier in a Svelte script": [
    "a.svelte",
    `<script lang="ts">\n  let ayme: Ayme;\n</script>\n`,
  ],
  "an identifier in a Markdown script block": [
    "a.md",
    "Text.\n\n- Item:\n\n  ```ts\n  let ayme: Ayme;\n  ```\n",
  ],
  "an identifier in a quoted Markdown script block": [
    "a.md",
    "> ```ts\n> let ayme: Ayme;\n> ```\n",
  ],
  "an identifier after a line that only looks like the closing fence": [
    "a.md",
    "~~~ts\nconst text = `\n~~~text\n`;\nlet ayme: Ayme;\n~~~\n",
  ],
  "an identifier in a Vue block in Markdown": [
    "a.md",
    '```vue\n<script setup lang="ts">\nlet ayme: Ayme;\n</script>\n```\n',
  ],
  "syntax that only TypeScript without JSX has": [
    "a.md",
    "```ts\nconst make = <T>(value: T): Ayme => of(value);\n```\n",
  ],
  "an identifier in a Markdown block with CRLF line ends": [
    "a.md",
    "```ts\r\nlet ayme: Ayme;\r\n```\r\n",
  ],
  "the type's code span in Markdown": ["a.md", "Returns `Ayme`.\n"],
  "the name in lowercase": ["a.md", "# ayme\n\nayme labs makes ayme.\n"],
  "a generated changelog": ["packages/lib/CHANGELOG.md", "* ships Ayme\n"],
};
for (const [name, [file, text]] of Object.entries(passes))
  test(`allows ${name}`, () => {
    assert.deepEqual(capitalizedNames(file, text), []);
  });

const fails = {
  "Markdown prose and headings": [
    "a.md",
    "# Ayme\n\nAyme's _Ayme_.\n",
    [1, 3, 3],
  ],
  "the type's code span inside a Markdown block": [
    "a.md",
    "```text\n`Ayme`\n```\n",
    [2],
  ],
  "a script block that is text inside a longer fence": [
    "a.md",
    "````text\n```ts\nAyme\n```\n````\n",
    [3],
  ],
  "prose after a script block": ["a.md", "```ts\nAyme;\n```\n\nAyme\n", [5]],
  "a script in an HTML comment": [
    "a.html",
    "<!-- <script>Ayme</script> -->\n",
    [1],
  ],
  "a script element that holds text": [
    "a.html",
    '<script type="text/plain">Ayme</script>\n',
    [1],
  ],
  "a comment in source too deep to walk by recursion": [
    "a.ts",
    `x = ${Array(6000).fill("1").join(" + ")}; // Ayme\n`,
    [1],
  ],
  "the company's name with one capital": ["a.txt", "ayme Labs\n", [1]],
  "the company's name": ["a.txt", "Ayme Labs\n", [1]],
  "a quoted message in a Markdown code span": [
    "a.md",
    "`The Ayme runtime`\n",
    [1],
  ],
  "a comment in a Markdown script block": [
    "a.md",
    "```ts\n// Ayme\nlet ayme: Ayme;\n```\n",
    [2],
  ],
  "Markdown code that is not script": ["a.md", "```sh\n# Ayme\n```\n", [2]],
  "script comments, strings and templates": [
    "a.ts",
    'let ayme: Ayme; // Ayme\n/** Ayme */\nfail("Ayme");\nfail(`Ayme ${ayme} Ayme`);\n',
    [1, 2, 3, 4, 4],
  ],
  "the name after an escape in a string": [
    "a.ts",
    String.raw`fail("x\nAyme");`,
    [1],
  ],
  "JSX text": ["a.tsx", "const a = <p>Ayme</p>;\n", [1]],
  "a Vue template": [
    "a.vue",
    "<script>\nlet a;\n</script>\n<template>Ayme</template>\n",
    [4],
  ],
  JSON: ["package.json", '{ "description": "Ayme" }\n', [1]],
};
for (const [name, [file, text, lines]] of Object.entries(fails))
  test(`fails on ${name}`, () => {
    assert.deepEqual(capitalizedNames(file, text), lines);
  });

test("reads the tracked text files of a repository", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-name-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root });
  git("init", "-q");
  assert.deepEqual(checkName(root), []);
  fs.writeFileSync(path.join(root, "tracked.txt"), "one\nAyme\n");
  fs.writeFileSync(path.join(root, "binary.bin"), "\0Ayme");
  git("add", ".");
  fs.writeFileSync(path.join(root, "untracked.txt"), "Ayme\n");
  assert.deepEqual(checkName(root), [
    'tracked.txt:2: write "ayme" and "ayme labs" in lowercase',
  ]);
});
