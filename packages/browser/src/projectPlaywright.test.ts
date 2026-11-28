import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  BrowserError,
  placeInRange,
  projectPlaywright,
  projectPlaywrightCli,
  SUPPORTED_PLAYWRIGHT,
} from "./index";

// Outside the repository, so no Playwright resolves from it: the package
// never falls back to one of its own.
let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "ayme-browser-project-"));
});
afterEach(() => rm(folder, { recursive: true }));

/** Installs a stand-in for Playwright under `name` in `root`. */
async function installPlaywright(
  root: string,
  name: string,
  { version = "1.64.0", cli = false } = {}
) {
  const installed = join(root, "node_modules", name);
  await mkdir(installed, { recursive: true });
  await writeFile(
    join(installed, "package.json"),
    JSON.stringify({ name, version, main: "index.js" })
  );
  await writeFile(
    join(installed, "index.js"),
    `exports.chromium = { name: ${JSON.stringify(name)} };\n`
  );
  if (cli) await writeFile(join(installed, "cli.js"), "");
  return installed;
}

const found = (projectFolder: string) =>
  Effect.runPromise(
    projectPlaywright(projectFolder).pipe(
      Effect.map(({ playwright, version }) => ({
        chromium: playwright.chromium as unknown,
        version,
      }))
    )
  );

const failure = (projectFolder: string) =>
  Effect.runPromise(Effect.flip(projectPlaywright(projectFolder)));

it("fails, saying so, when the project has no Playwright installed", async () => {
  const error = await failure(folder);

  expect(error).toBeInstanceOf(BrowserError);
  expect(error).toMatchObject({
    kind: "no Playwright in the project",
    message: `No Playwright is installed in ${folder}.`,
  });
});

it.each(["playwright", "@playwright/test", "playwright-core"])(
  "finds the project's Playwright installed as %s, with its version",
  async (name) => {
    await installPlaywright(folder, name, { version: "1.64.2" });

    expect(await found(folder)).toEqual({
      chromium: { name },
      version: "1.64.2",
    });
  }
);

it("finds the Playwright installed above the project folder, as in a monorepo", async () => {
  await installPlaywright(folder, "playwright");
  const projectFolder = join(folder, "packages", "app");
  await mkdir(projectFolder, { recursive: true });

  expect(await found(projectFolder)).toMatchObject({
    chromium: { name: "playwright" },
  });
});

it("prefers playwright, then @playwright/test, then playwright-core", async () => {
  await installPlaywright(folder, "playwright-core");
  await installPlaywright(folder, "@playwright/test");
  expect(await found(folder)).toMatchObject({
    chromium: { name: "@playwright/test" },
  });

  await installPlaywright(folder, "playwright");
  expect(await found(folder)).toMatchObject({
    chromium: { name: "playwright" },
  });
});

it("fails, naming the version, when the project's Playwright is older than the supported range", async () => {
  await installPlaywright(folder, "@playwright/test", { version: "1.61.1" });

  expect(await failure(folder)).toMatchObject({
    kind: "unsupported Playwright version",
    message: `${folder} has Playwright 1.61.1.`,
  });
});

it("fails, naming the broken install, when the project's Playwright cannot be loaded", async () => {
  const installed = await installPlaywright(folder, "playwright");
  await rm(join(installed, "index.js"));

  const error = await failure(folder);

  expect(error).toBeInstanceOf(BrowserError);
  expect(error).toMatchObject({
    kind: "no Playwright in the project",
    message: `The Playwright at ${installed} cannot be loaded (Error: Cannot find module '${join(installed, "index.js")}'. Please verify that the package.json has a valid "main" entry).`,
  });
});

it("fails, naming the broken install, when the project's Playwright has an unreadable manifest", async () => {
  const installed = await installPlaywright(folder, "playwright");
  await writeFile(join(installed, "package.json"), "{");

  const error = await failure(folder);

  expect(error.kind).toBe("no Playwright in the project");
  expect(error.message).toMatch(
    `The Playwright at ${installed} cannot be loaded (SyntaxError: `
  );
  expect(error.message).not.toContain("\n");
});

it("finds a Playwright newer than the verified range", async () => {
  await installPlaywright(folder, "playwright", { version: "1.99.0" });

  expect(await found(folder)).toMatchObject({ version: "1.99.0" });
});

it("places a version against the supported range by its minor", () => {
  const [major, floorMinor] = SUPPORTED_PLAYWRIGHT.floor.split(".");
  const lastMinor = SUPPORTED_PLAYWRIGHT.lastVerified.split(".")[1];

  expect(placeInRange(`${major}.${Number(floorMinor) - 1}.9`)).toBe("below");
  expect(placeInRange(`${SUPPORTED_PLAYWRIGHT.floor}.0`)).toBe("within");
  expect(placeInRange(`${SUPPORTED_PLAYWRIGHT.lastVerified}.7`)).toBe("within");
  expect(placeInRange(`${major}.${Number(lastMinor) + 1}.0`)).toBe("above");
  expect(placeInRange(`${Number(major) + 1}.0.0`)).toBe("above");
  expect(placeInRange(`${Number(major) - 1}.99.0`)).toBe("below");
});

it("gives the command line of the project's Playwright, or none", async () => {
  expect(projectPlaywrightCli(folder)).toBeUndefined();

  // An installed package without a command line is passed over.
  await installPlaywright(folder, "playwright");
  const withCli = await installPlaywright(folder, "@playwright/test", {
    cli: true,
  });

  expect(projectPlaywrightCli(folder)).toBe(join(withCli, "cli.js"));
});
