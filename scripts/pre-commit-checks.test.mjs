import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  TEST_TASK_CAP,
  countTestTasks,
  filtersFor,
  indexedWorkspaces,
  planSelection,
  skipMessage,
} from "./pre-commit-checks.mjs";

const WORKSPACES = ["packages/vue", "packages/svelte", "apps/example-vue"];
const EXCLUDE_HEAVY = [
  "--filter=!@ayme-dev/example-next",
  "--filter=!@ayme-dev/example-nuxt",
];

test("planSelection selects the workspaces staged paths are in, once each", () => {
  const plan = planSelection(
    [
      "packages/vue/src/a.ts",
      "packages/vue/src/b.ts",
      "apps/example-vue/src/App.vue",
    ],
    WORKSPACES
  );
  assert.deepEqual(plan, {
    all: false,
    workspaces: ["apps/example-vue", "packages/vue"],
    removed: [],
    quickstart: false,
  });
});

test("planSelection ignores files outside workspaces", () => {
  const plan = planSelection(
    ["packages/README.md", "docs/guide/index.md", "scripts/x.mjs"],
    WORKSPACES
  );
  assert.deepEqual(plan.workspaces, []);
  assert.deepEqual(plan.removed, []);
  assert.equal(filtersFor(plan), undefined);
});

test("planSelection does not match a workspace by name prefix", () => {
  const plan = planSelection(["packages/vue-extra/src/a.ts"], WORKSPACES);
  assert.deepEqual(plan.workspaces, []);
  assert.deepEqual(plan.removed, ["packages/vue-extra"]);
});

test("planSelection reports directories that are no longer workspaces", () => {
  const plan = planSelection(["packages/gone/package.json"], WORKSPACES);
  assert.deepEqual(plan.removed, ["packages/gone"]);
  assert.equal(filtersFor(plan), undefined);
});

test("planSelection selects every workspace for a root global file", () => {
  for (const file of ["turbo.json", "pnpm-lock.yaml", "package.json"]) {
    const plan = planSelection([file, "packages/vue/src/a.ts"], WORKSPACES);
    assert.equal(plan.all, true, file);
    assert.deepEqual(filtersFor(plan), {
      selection: [],
      run: EXCLUDE_HEAVY,
    });
  }
});

test("planSelection treats a workspace's own turbo.json as that workspace", () => {
  const plan = planSelection(["apps/example-vue/turbo.json"], WORKSPACES);
  assert.equal(plan.all, false);
  assert.deepEqual(plan.workspaces, ["apps/example-vue"]);
});

test("planSelection notes a staged quickstart without selecting anything", () => {
  const plan = planSelection(
    ["docs/guide/start/quickstart-react.md"],
    WORKSPACES
  );
  assert.equal(plan.quickstart, true);
  assert.equal(filtersFor(plan), undefined);
  assert.equal(
    planSelection(["docs/guide/start/index.md"], WORKSPACES).quickstart,
    false
  );
});

test("filtersFor selects each workspace with its dependents and leaves out the heavy apps", () => {
  const plan = planSelection(
    ["packages/vue/src/a.ts", "packages/svelte/src/b.ts"],
    WORKSPACES
  );
  assert.deepEqual(filtersFor(plan), {
    selection: [
      "--filter=...{./packages/svelte}",
      "--filter=...{./packages/vue}",
    ],
    run: [
      "--filter=...{./packages/svelte}",
      "--filter=...{./packages/vue}",
      ...EXCLUDE_HEAVY,
    ],
  });
});

test("countTestTasks counts real test tasks only", () => {
  const dryRun = JSON.stringify({
    tasks: [
      { task: "test", command: "vitest run" },
      { task: "test", command: "<NONEXISTENT>" },
      { task: "build", command: "vite build" },
      { task: "test", command: "vitest run" },
    ],
  });
  assert.equal(countTestTasks(dryRun), 2);
});

test("countTestTasks fails on output it cannot read", () => {
  assert.throws(() => countTestTasks("not json"), SyntaxError);
  assert.throws(() => countTestTasks("{}"), /no tasks array/);
});

test("skipMessage names the count and asks for a ready pull request", () => {
  assert.match(
    skipMessage(TEST_TASK_CAP + 1),
    /^5 test tasks: leaving them to CI\. CI skips draft pull requests, so mark the PR ready\./
  );
});

test("indexedWorkspaces reads workspaces from the index, not the working tree", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pre-commit-checks-"));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (...args) => execFileSync("git", args, { cwd: dir, env });
  const write = (file, text) => {
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  try {
    git("init", "-q");
    write("packages/vue/package.json", "{}");
    git("add", ".");
    // An untracked manifest does not make a workspace.
    write("packages/notes/package.json", "{}");
    // An unstaged deletion does not remove one.
    fs.rmSync(path.join(dir, "packages/vue/package.json"));
    assert.deepEqual(
      indexedWorkspaces(
        ["packages/notes/README.md", "packages/vue/src/a.ts", "docs/a.md"],
        dir
      ),
      ["packages/vue"]
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
