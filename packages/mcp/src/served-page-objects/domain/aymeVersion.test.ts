import { expect, it } from "vitest";

import { aymeVersionMismatch } from "./aymeVersion";

const entry = "/project/.ayme/page-objects.ts";

const install = (
  packageManager: "npm" | "pnpm" | "yarn" | "bun",
  workspaceRoot = false
) => ({ packageManager, folder: "/project", workspaceRoot });

it("has nothing to say when the project's @ayme-dev/ayme is ayme mcp's version", () => {
  expect(
    aymeVersionMismatch({
      entry,
      project: "0.1.5",
      mcp: "0.1.5",
      install: install("pnpm"),
    })
  ).toBeUndefined();
});

it("names both versions and the command that installs ayme mcp's", () => {
  expect(
    aymeVersionMismatch({
      entry,
      project: "0.1.3",
      mcp: "0.1.5",
      install: install("pnpm"),
    })
  ).toBe(
    `Building the Page Objects entry ${entry} stopped: this project has @ayme-dev/ayme 0.1.3; ayme mcp 0.1.5 needs the same version. Run \`pnpm add -D @ayme-dev/ayme@0.1.5\` in /project.`
  );
});

it("pairs only the exact version, a prerelease of it included", () => {
  expect(
    aymeVersionMismatch({
      entry,
      project: "0.1.5-beta.1",
      mcp: "0.1.5",
      install: install("npm"),
    })
  ).toContain("this project has @ayme-dev/ayme 0.1.5-beta.1;");
});

it("stops when the project's version could not be read", () => {
  expect(
    aymeVersionMismatch({
      entry,
      project: undefined,
      mcp: "0.1.5",
      install: install("npm"),
    })
  ).toContain(
    "this project has @ayme-dev/ayme of a version it does not state; ayme mcp 0.1.5 needs the same version."
  );
});

for (const [packageManager, command] of [
  ["npm", "npm install -D"],
  ["pnpm", "pnpm add -D"],
  ["yarn", "yarn add -D"],
  ["bun", "bun add -d"],
] as const)
  it(`names ${packageManager}'s install command`, () => {
    expect(
      aymeVersionMismatch({
        entry,
        project: "0.1.3",
        mcp: "0.1.5",
        install: install(packageManager),
      })
    ).toMatch(
      new RegExp(` Run \`${command} @ayme-dev/ayme@0\\.1\\.5\` in /project\\.$`)
    );
  });

it("tells pnpm to add to a workspace's root when the project is that root", () => {
  expect(
    aymeVersionMismatch({
      entry,
      project: "0.1.3",
      mcp: "0.1.5",
      install: install("pnpm", true),
    })
  ).toContain(" Run `pnpm add -D -w @ayme-dev/ayme@0.1.5` in /project.");
});

it("adds no -w for another package manager at a pnpm workspace's root", () => {
  expect(
    aymeVersionMismatch({
      entry,
      project: "0.1.3",
      mcp: "0.1.5",
      install: install("npm", true),
    })
  ).toContain(" Run `npm install -D @ayme-dev/ayme@0.1.5` in /project.");
});
