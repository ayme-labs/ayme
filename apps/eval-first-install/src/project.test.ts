import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { PACKAGES } from "./pack.ts";
import { buildProject } from "./project.ts";

let work: string;
let packedDir: string;
let project: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "eval-first-install-project-"));
  packedDir = join(work, "packed");
  project = join(work, "project");
  mkdirSync(join(packedDir, "skill", "references"), { recursive: true });
  writeFileSync(join(packedDir, "skill", "SKILL.md"), "# ayme\n");
  mkdirSync(join(packedDir, "docs", "guides"), { recursive: true });
  writeFileSync(join(packedDir, "docs", "guides", "connect-an-agent.md"), "");
  buildProject(
    project,
    { dir: packedDir, version: "0.3.0-first-install.gabc" },
    "http://127.0.0.1:4873/"
  );
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

const manifest = () =>
  JSON.parse(readFileSync(join(project, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies: Record<string, string>;
  };

it("has the packed @ayme-dev/ayme and Playwright 1.62 or newer, but no ayme command: the worker installs @ayme-dev/cli", () => {
  const { dependencies, devDependencies } = manifest();
  const playwright = /^(\d+)\.(\d+)\./.exec(
    devDependencies["@playwright/test"]!
  );

  expect(devDependencies["@ayme-dev/ayme"]).toBe("0.3.0-first-install.gabc");
  expect(
    Number(playwright![1]) * 1000 + Number(playwright![2])
  ).toBeGreaterThanOrEqual(1062);
  expect(
    Object.keys({ ...dependencies, ...devDependencies }).filter((name) =>
      name.startsWith("@ayme-dev/")
    )
  ).toEqual(["@ayme-dev/ayme"]);
});

it("installs from the run's registry, which holds every @ayme-dev package the project and the worker install", () => {
  expect(readFileSync(join(project, ".npmrc"), "utf8")).toBe(
    "registry=http://127.0.0.1:4873/\n"
  );
  expect(PACKAGES).toEqual(expect.arrayContaining(["ayme", "cli"]));
  expect(PACKAGES).not.toContain("mcp");
});

it("holds the ref's ayme skill where Claude Code finds it, its guide in ayme-docs, and the Page Objects in ayme/", () => {
  expect(
    readFileSync(join(project, ".claude/skills/ayme/SKILL.md"), "utf8")
  ).toBe("# ayme\n");
  expect(
    existsSync(join(project, "ayme-docs/guides/connect-an-agent.md"))
  ).toBe(true);
  expect(existsSync(join(project, "ayme/page-objects.ts"))).toBe(true);
  expect(existsSync(join(project, "package.json.template"))).toBe(false);
});
