import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, it, onTestFinished, vi } from "vitest";

import { projectAymeInstall } from "./projectAymeInstall";

/**
 * A project with a Page Objects entry, a `package.json` and a pnpm
 * lockfile, and `install`, which installs a fake `@ayme-dev/ayme` of a
 * version as a package manager would: by pointing its folder at another
 * copy, as pnpm does, or by writing over it.
 */
async function aymeProject() {
  const project = await realpath(
    await mkdtemp(join(tmpdir(), "ayme-install-"))
  );
  const entry = join(project, "ayme", "page-objects.ts");
  await mkdir(dirname(entry), { recursive: true });
  await writeFile(entry, "export default {};\n");
  await writeFile(join(project, "package.json"), "{}");
  await writeFile(join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const installed = join(project, "node_modules", "@ayme-dev", "ayme");
  const install = async (
    version: string,
    how: "repoint" | "replace" = "replace"
  ) => {
    const target =
      how === "repoint" ? join(project, "store", version) : installed;
    // The compiler entry came after the first releases.
    const compiler = version !== "0.0.1";
    await mkdir(target, { recursive: true });
    await writeFile(
      join(target, "package.json"),
      JSON.stringify({
        name: "@ayme-dev/ayme",
        version,
        type: "module",
        exports: {
          ".": "./index.mjs",
          ...(compiler ? { "./compiler": "./compiler.mjs" } : {}),
        },
      })
    );
    await writeFile(join(target, "index.mjs"), "export const ayme = 1;\n");
    if (compiler)
      await writeFile(
        join(target, "compiler.mjs"),
        'throw new Error("Resolving the compiler must not load it");'
      );
    if (how === "repoint") {
      await mkdir(dirname(installed), { recursive: true });
      await rm(installed, { recursive: true, force: true });
      await symlink(target, installed, "dir");
    }
  };
  return {
    project,
    entry,
    install,
    remove: () => rm(project, { recursive: true, force: true }),
    installed,
  };
}

it.each(["repoint", "replace"] as const)(
  "resolves the compiler afresh after an install that %ss the package",
  async (how) => {
    const { entry, install, project, remove, installed } = await aymeProject();
    onTestFinished(remove);
    const lookup = projectAymeInstall(entry, "0.2.0");
    await install("0.0.1", how);
    expect(await lookup.resolve()).toEqual({
      kind: "cannot-start",
      version: "0.0.1",
      compiler: undefined,
      install: {
        folder: project,
        packageManager: "pnpm",
        workspaceRoot: false,
      },
      error: `Building the Page Objects entry ${entry} stopped: this project has @ayme-dev/ayme 0.0.1; ayme mcp 0.2.0 needs the same version. Run \`pnpm add -D @ayme-dev/ayme@0.2.0\` in ${project}.`,
    });

    await install("0.2.0", how);
    expect(await lookup.resolve()).toEqual({
      kind: "ready",
      version: "0.2.0",
      compiler: join(
        how === "repoint" ? join(project, "store", "0.2.0") : installed,
        "compiler.mjs"
      ),
      install: {
        folder: project,
        packageManager: "pnpm",
        workspaceRoot: false,
      },
    });
  }
);

it("names the nearest package and lockfile, and keeps watching a deleted lockfile", async () => {
  const { project, entry, remove } = await aymeProject();
  const lockfile = join(project, "pnpm-lock.yaml");
  const app = dirname(entry);
  const manifest = join(app, "package.json");
  const unrelated = join(app, "other.txt");
  await writeFile(manifest, "{}");
  const lookup = projectAymeInstall(entry, "0.2.0");
  const changed = vi.fn();
  const failed = vi.fn();
  let stop = () => {};
  try {
    const first = lookup.subscribe(changed, failed, []);
    stop = first.stop;
    expect(first.files).toEqual([manifest, lockfile]);
    // On macOS, a watch misses what is written as it starts.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await writeFile(unrelated, "");
    await writeFile(manifest, '{"private": true}');
    await expect.poll(() => changed.mock.calls.length).toBeGreaterThan(0);
    changed.mockClear();
    await rm(lockfile);
    await expect.poll(() => changed.mock.calls.length).toBeGreaterThan(0);

    stop();
    const next = lookup.subscribe(changed, failed, first.files);
    stop = next.stop;
    expect(next.files).toEqual([manifest, lockfile]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    changed.mockClear();
    await writeFile(lockfile, "");
    await expect.poll(() => changed.mock.calls.length).toBeGreaterThan(0);
    expect(failed).not.toHaveBeenCalled();
  } finally {
    stop();
    await remove();
  }
});

it("names the missing runtime and a matching release's missing compiler", async () => {
  const { entry, remove } = await aymeProject();
  try {
    const beforeInstall = await projectAymeInstall(entry, "0.0.1").resolve();
    expect(beforeInstall).toMatchObject({
      kind: "cannot-start",
      error: `Building the Page Objects entry ${entry} needs @ayme-dev/ayme, which does not resolve from ${dirname(entry)}.`,
    });
  } finally {
    await remove();
  }
  const { entry: older, project } = await projectWithAyme("0.1.5", {
    compiler: false,
  });
  try {
    expect(await mismatch({ entry: older, project })).toBe(
      `Building the Page Objects entry ${older} needs @ayme-dev/ayme/compiler, which does not resolve from ${dirname(older)}.`
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

/**
 * A project folder, with a `package.json` and `files`, its Page Objects
 * entry and an installed `@ayme-dev/ayme`. A release from before the compiler
 * entry has no `./compiler`.
 */
async function projectWithAyme(
  version: string | undefined,
  {
    files = [],
    compiler = true,
    distManifest,
  }: {
    files?: readonly string[];
    compiler?: boolean;
    /** A `package.json` in the package's `dist`, such as a bundler writes. */
    distManifest?: object;
  } = {}
) {
  const project = await realpath(
    await mkdtemp(join(tmpdir(), "ayme-version-"))
  );
  const ayme = join(project, "node_modules", "@ayme-dev", "ayme");
  await mkdir(join(ayme, "dist"), { recursive: true });
  await writeFile(
    join(ayme, "package.json"),
    JSON.stringify({
      name: "@ayme-dev/ayme",
      version,
      type: "module",
      exports: {
        ".": "./dist/index.js",
        ...(compiler ? { "./compiler": "./dist/compiler.js" } : {}),
      },
    })
  );
  await writeFile(
    join(ayme, "dist", "index.js"),
    'export const runtime = "ayme";'
  );
  await writeFile(
    join(ayme, "dist", "compiler.js"),
    'throw new Error("Resolving the compiler must not load it");'
  );
  if (distManifest !== undefined)
    await writeFile(
      join(ayme, "dist", "package.json"),
      JSON.stringify(distManifest)
    );
  await writeFile(join(project, "package.json"), "{}");
  for (const file of files) await writeFile(join(project, file), "");
  const entry = join(project, "ayme", "page-objects.ts");
  await mkdir(dirname(entry));
  await writeFile(entry, "export default [];");
  return { project, entry };
}

/** Why the install cannot start a build with ayme mcp 0.1.5. */
async function mismatch({
  project,
  entry,
}: Awaited<ReturnType<typeof projectWithAyme>>) {
  try {
    const found = await projectAymeInstall(entry, "0.1.5").resolve();
    assert(found.kind === "cannot-start");
    return found.error;
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

it("names the older release's version and the install command for a pnpm workspace root", async () => {
  const project = await projectWithAyme("0.1.3", {
    files: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
    compiler: false,
  });
  expect(await mismatch(project)).toContain(
    `this project has @ayme-dev/ayme 0.1.3; ayme mcp 0.1.5 needs the same version. Run \`pnpm add -D -w @ayme-dev/ayme@0.1.5\` in ${project.project}.`
  );
});

it("names npm's command when no lockfile is above the project", async () => {
  const project = await projectWithAyme("0.1.3");
  expect(await mismatch(project)).toContain(
    ` Run \`npm install -D @ayme-dev/ayme@0.1.5\` in ${project.project}.`
  );
});

it("reads the version from the package's own package.json, not another one inside it", async () => {
  for (const distManifest of [
    { name: "bundled", version: "9.9.9" },
    { name: "@ayme-dev/ayme" },
  ])
    expect(
      await mismatch(await projectWithAyme("0.1.3", { distManifest }))
    ).toContain("this project has @ayme-dev/ayme 0.1.3;");
});

it("stops when no package.json states the version of @ayme-dev/ayme", async () => {
  expect(await mismatch(await projectWithAyme(undefined))).toContain(
    "this project has @ayme-dev/ayme of a version it does not state;"
  );
});
