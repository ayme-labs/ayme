import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runInstall } from "./install";

// `install` goes to the project's own `playwright install`: the engine finds
// that Playwright and runs it where the project is. The tests give it a
// stand-in `cli.js` that writes down how it was run.

let project: string;
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "ayme-recorder-install-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  return rm(project, { recursive: true });
});

/** Installs a stand-in Playwright whose command line writes its arguments
 * and folder to `ran.json`, and exits with `exitCode`. */
async function installPlaywright(name: string, exitCode = 0) {
  const folder = join(project, "node_modules", name);
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "package.json"),
    JSON.stringify({ name, version: "1.64.0" })
  );
  await writeFile(
    join(folder, "cli.js"),
    `require("node:fs").writeFileSync(
  ${JSON.stringify(join(project, "ran.json"))},
  JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() })
);
process.exit(${exitCode});\n`
  );
}
const ran = async () =>
  JSON.parse(await readFile(join(project, "ran.json"), "utf8")) as {
    args: string[];
    cwd: string;
  };

describe("the install command", () => {
  it.each(["playwright", "@playwright/test", "playwright-core"])(
    "runs the project's own %s with `install` and the arguments, in the project's folder",
    async (name) => {
      await installPlaywright(name);

      const code = await runInstall({
        projectDir: project,
        args: ["--with-deps", "chromium"],
      });

      expect(code).toBe(0);
      expect(await ran()).toEqual({
        args: ["install", "--with-deps", "chromium"],
        // The folder as the stand-in sees it, which may be a symlinked one.
        cwd: expect.stringContaining(project.split("/").pop()!),
      });
    }
  );

  it("exits with the exit code of the project's Playwright", async () => {
    await installPlaywright("playwright", 3);

    expect(await runInstall({ projectDir: project, args: ["chromium"] })).toBe(
      3
    );
  });

  it("says so, with no stack trace, when the project has no Playwright", async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((text) => {
      written.push(String(text));
      return true;
    });

    expect(await runInstall({ projectDir: project, args: ["chromium"] })).toBe(
      1
    );
    expect(written.join("")).toContain(
      `No Playwright is installed in ${project}`
    );
  });
});
