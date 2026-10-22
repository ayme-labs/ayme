import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { findCycles } from "./check-cycles.mjs";

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** A workspace with a `@/*` alias and `files` under its `src`; returns `src`. */
function workspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-cycles-"));
  roots.push(root);
  const tsconfig = {
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      paths: { "@/*": ["./src/*"] },
    },
  };
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify(tsconfig));
  for (const [file, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, "src", file)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(root, "src", file), contents);
  }
  return path.join(root, "src");
}

test("fails on a cycle of runtime imports", async () => {
  const src = workspace({
    "a.ts": `import { b } from "./b";\nexport const a = () => b;\n`,
    "b.ts": `import { a } from "./a";\nexport const b = () => a;\n`,
  });
  assert.deepEqual(await findCycles([src]), [`${src}: a.ts > b.ts`]);
});

test("follows the workspace's path aliases", async () => {
  const src = workspace({
    "a.ts": `import { b } from "@/b";\nexport const a = () => b;\n`,
    "b.ts": `import { a } from "./a";\nexport const b = () => a;\n`,
  });
  assert.deepEqual(await findCycles([src]), [`${src}: a.ts > b.ts`]);
});

test("fails on a cycle of Vue components alone", async () => {
  const src = workspace({
    "Parent.vue": `<script setup lang="ts">\nimport Child from "./Child.vue";\n</script>\n`,
    "Child.vue": `<script setup lang="ts">\nimport Parent from "./Parent.vue";\n</script>\n`,
  });
  assert.deepEqual(await findCycles([src]), [`${src}: Child.vue > Parent.vue`]);
});

test("passes a cycle closed by a type-only import, in TypeScript or Vue", async () => {
  const src = workspace({
    "a.ts": `import { b } from "./b";\nimport View from "./View.vue";\nexport type A = number;\nexport const a = () => [b, View];\n`,
    "b.ts": `import type { A } from "./a";\nexport const b = (value: A) => value;\n`,
    "View.vue": `<script setup lang="ts">\nimport type { A } from "./a";\ndefineProps<{ value: A }>();\n</script>\n`,
  });
  assert.deepEqual(await findCycles([src]), []);
});

test("leaves out fixtures and generated shadcn-vue components", async () => {
  const src = workspace({
    "fixtures/a.ts": `import { b } from "./b";\nexport const a = () => b;\n`,
    "fixtures/b.ts": `import { a } from "./a";\nexport const b = () => a;\n`,
    "components/ui/badge/index.ts": `export { default as Badge } from "./Badge.vue";\nexport const badgeVariants = () => "";\n`,
    "components/ui/badge/Badge.vue": `<script setup lang="ts">\nimport { badgeVariants } from ".";\nbadgeVariants();\n</script>\n`,
  });
  assert.deepEqual(await findCycles([src]), []);
});
