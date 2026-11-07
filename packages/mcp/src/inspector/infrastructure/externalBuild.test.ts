import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, expect, it } from "vitest";

import { readExternalBuild } from "./externalBuild";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0))
    await rm(folder, { recursive: true, force: true });
});

it("reads the script of the package export it is given", async () => {
  const folder = await mkdtemp(join(tmpdir(), "ayme-external-"));
  folders.push(folder);
  await mkdir(join(folder, "dist"));
  await writeFile(join(folder, "dist", "external.mjs"), "export {};");

  expect(
    await readExternalBuild(
      pathToFileURL(join(folder, "dist", "external.mjs")).href
    )
  ).toBe("export {};");
});

it("finds nothing when the Inspector's package is not installed", async () => {
  expect(
    await readExternalBuild("@ayme-dev/no-such-package/external")
  ).toBeUndefined();
});
