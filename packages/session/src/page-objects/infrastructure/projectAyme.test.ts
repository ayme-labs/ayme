import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, it } from "vitest";

import { projectAyme } from "./projectAyme";

// Outside the repository, so no @ayme-dev/ayme resolves from it: the
// Session never falls back to a copy of its own.
let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "ayme-session-project-"));
});
afterEach(() => rm(folder, { recursive: true }));

/** Installs a stand-in for @ayme-dev/ayme in `root`. */
async function installAyme(
  root: string,
  manifest: Record<string, unknown> = { version: "0.3.0" }
) {
  const installed = join(root, "node_modules", "@ayme-dev", "ayme");
  await mkdir(installed, { recursive: true });
  await writeFile(
    join(installed, "package.json"),
    JSON.stringify({
      name: "@ayme-dev/ayme",
      exports: {
        "./compiler": { types: "./c.d.mts", import: "./dist/compiler.mjs" },
        "./internal": { default: "./dist/internal.mjs" },
      },
      ...manifest,
    })
  );
  return installed;
}

/** Adds the project's Page Objects entry. */
async function addEntry(root: string) {
  await mkdir(join(root, "ayme"), { recursive: true });
  await writeFile(join(root, "ayme", "page-objects.ts"), "export default [];");
}

const found = (projectDir: string) =>
  Effect.runPromise(projectAyme(projectDir, "0.3.0"));

const refusal = async (projectDir: string) =>
  (await Effect.runPromise(Effect.flip(projectAyme(projectDir, "0.3.0"))))
    .message;

it("finds the project's own @ayme-dev/ayme, its entries, and the project's Page Objects entry", async () => {
  const installed = await installAyme(folder);
  await addEntry(folder);

  expect(await found(folder)).toEqual({
    entry: join(folder, "ayme", "page-objects.ts"),
    compiler: join(installed, "dist", "compiler.mjs"),
    nodeHost: join(installed, "dist", "internal.mjs"),
  });
});

it("finds an @ayme-dev/ayme installed above the project folder, as in a monorepo", async () => {
  const installed = await installAyme(folder);
  const projectDir = join(folder, "apps", "shop");
  await addEntry(projectDir);

  expect(await found(projectDir)).toMatchObject({
    nodeHost: join(installed, "dist", "internal.mjs"),
  });
});

it("refuses a project without @ayme-dev/ayme, naming the version to install", async () => {
  await addEntry(folder);

  expect(await refusal(folder)).toBe(
    `No @ayme-dev/ayme is installed in ${folder}. ayme runs the project's Page Objects with the project's own @ayme-dev/ayme: install version 0.3.0 there, for example with "npm install -D @ayme-dev/ayme@0.3.0".`
  );
});

it.each([
  [{ version: "0.2.0" }, "@ayme-dev/ayme 0.2.0"],
  [{ version: undefined }, "an @ayme-dev/ayme that states no version"],
])(
  "refuses an @ayme-dev/ayme of another version, naming the one that works: %j",
  async (manifest, has) => {
    await installAyme(folder, manifest);
    await addEntry(folder);

    expect(await refusal(folder)).toBe(
      `${folder} has ${has}. This ayme, 0.3.0, runs Page Objects only with @ayme-dev/ayme 0.3.0, which is released with it: install that version, for example with "npm install -D @ayme-dev/ayme@0.3.0".`
    );
  }
);

it("refuses an @ayme-dev/ayme whose package.json is damaged, naming the file", async () => {
  const installed = await installAyme(folder);
  await writeFile(join(installed, "package.json"), '{ "version": ');
  await addEntry(folder);

  expect(await refusal(folder)).toMatch(
    new RegExp(
      `^The package.json of the @ayme-dev/ayme at ${installed} is not JSON \\(.+\\)\\. Install @ayme-dev/ayme 0\\.3\\.0 again, for example with "npm install -D @ayme-dev/ayme@0\\.3\\.0"\\.$`
    )
  );
});

it("refuses an @ayme-dev/ayme that lacks an entry the Session needs", async () => {
  const installed = await installAyme(folder, {
    version: "0.3.0",
    exports: { "./compiler": "./dist/compiler.mjs" },
  });
  await addEntry(folder);

  expect(await refusal(folder)).toBe(
    `The @ayme-dev/ayme at ${installed} has no ./internal entry, which ayme runs Page Objects with. Install @ayme-dev/ayme 0.3.0 again, for example with "npm install -D @ayme-dev/ayme@0.3.0".`
  );
});

it("refuses a project without a Page Objects entry, saying what the entry holds", async () => {
  await installAyme(folder);

  expect(await refusal(folder)).toBe(
    `${folder} has no ayme/page-objects.ts. A Session runs the Page Objects that file lists: its default export is an array of the project's Page Object classes.`
  );
});
