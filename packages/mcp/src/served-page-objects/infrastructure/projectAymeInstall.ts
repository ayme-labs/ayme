import { existsSync, readFileSync, watch } from "node:fs";
import { basename, dirname, join } from "node:path";

import * as esbuild from "esbuild";

import {
  aymeVersionMismatch,
  type PackageManager,
  type ProjectInstall,
} from "../domain/aymeVersion";

const RUNTIME = "@ayme-dev/ayme";
const COMPILER = "@ayme-dev/ayme/compiler";

type InstallResolution = {
  install: ProjectInstall;
  version: string | undefined;
} & (
  | { kind: "ready"; compiler: string }
  | { kind: "cannot-start"; compiler: string | undefined; error: string }
);

type InstallWatch = { files: readonly string[]; stop(): void };

export type ProjectAymeInstall = {
  resolve(): Promise<InstallResolution>;
  subscribe(
    changed: () => void,
    failed: () => void,
    previousFiles: readonly string[]
  ): InstallWatch;
};

/** Reads both entries afresh because Node caches resolved paths across installs. */
export function projectAymeInstall(
  entry: string,
  mcpVersion: string
): ProjectAymeInstall {
  const folder = dirname(entry);
  return {
    async resolve() {
      const resolved = await resolveAfresh(folder, [RUNTIME, COMPILER]);
      const { install } = installLocation(folder);
      const runtime = resolved.get(RUNTIME);
      const version =
        runtime === undefined ? undefined : packageVersion(runtime, RUNTIME);
      const compiler = resolved.get(COMPILER);
      const cannotStart = (error: string) =>
        ({ kind: "cannot-start", error, compiler, install, version }) as const;
      const doesNotResolve = (specifier: string) =>
        cannotStart(
          `Building the Page Objects entry ${entry} needs ${specifier}, which does not resolve from ${folder}.`
        );
      if (runtime === undefined) return doesNotResolve(RUNTIME);
      const mismatch = aymeVersionMismatch({
        entry,
        project: version,
        mcp: mcpVersion,
        install,
      });
      if (mismatch !== undefined) return cannotStart(mismatch);
      return compiler === undefined
        ? doesNotResolve(COMPILER)
        : { kind: "ready", compiler, install, version };
    },
    subscribe(changed, failed, previousFiles) {
      const { install, lockfile } = installLocation(folder);
      // Keep a previously watched lockfile so its recreation triggers a start.
      const files = [
        ...new Set([
          ...previousFiles,
          join(install.folder, "package.json"),
          ...(lockfile === undefined
            ? []
            : [join(lockfile.folder, lockfile.name)]),
        ]),
      ];
      return { files, stop: watchFiles(files, changed, failed) };
    },
  };
}

/**
 * Calls `changed` whenever one of `files` is written, created or removed,
 * and `failed` if watching stops on its own; returns how to stop. Watches
 * each file's folder, so a file that does not exist yet is watched too.
 */
function watchFiles(
  files: readonly string[],
  changed: () => void,
  failed: () => void
): () => void {
  const names = new Map<string, Set<string>>();
  for (const file of files)
    names.set(
      dirname(file),
      (names.get(dirname(file)) ?? new Set()).add(basename(file))
    );
  const watchers: ReturnType<typeof watch>[] = [];
  const stop = () => watchers.forEach((watcher) => watcher.close());
  try {
    for (const [folder, inFolder] of names) {
      const watcher = watch(folder, (_event, name) => {
        if (name === null || inFolder.has(String(name))) changed();
      });
      // A watched folder that goes away stops the watching, not the server.
      watcher.on("error", () => {
        stop();
        failed();
      });
      watchers.push(watcher);
    }
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

/** Each of `specifiers` that resolves from `folder` as an import, by esbuild, which keeps nothing between builds. */
async function resolveAfresh(
  folder: string,
  specifiers: readonly string[]
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const probe = Symbol("resolving");
  await esbuild.build({
    stdin: {
      contents: specifiers
        .map((s) => `import ${JSON.stringify(s)};`)
        .join("\n"),
      resolveDir: folder,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    plugins: [
      {
        name: "ayme-resolve-afresh",
        setup(build) {
          build.onResolve({ filter: /.*/ }, async ({ path, pluginData }) => {
            if (pluginData === probe || !specifiers.includes(path)) return;
            const result = await build.resolve(path, {
              kind: "import-statement",
              resolveDir: folder,
              pluginData: probe,
            });
            if (result.errors.length === 0) resolved.set(path, result.path);
            return { path, external: true };
          });
        },
      },
    ],
  });
  return resolved;
}

/**
 * The version of the package `name` that `file` belongs to, read from the
 * nearest `package.json` above it with that name, or `undefined` if none.
 */
function packageVersion(file: string, name: string): string | undefined {
  for (let folder = dirname(file); ; folder = dirname(folder)) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(folder, "package.json"), "utf8")
      ) as { name?: unknown; version?: unknown };
      if (manifest.name === name && typeof manifest.version === "string")
        return manifest.version;
    } catch {
      // No package.json here, or not one that parses: look further up.
    }
    if (dirname(folder) === folder) return undefined;
  }
}

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/**
 * Where and how to install a package for the project `folder` is in: the
 * nearest folder above it with a `package.json` (`folder` itself if none),
 * the package manager of the lockfile nearest above that (npm if none), and
 * whether that folder is a pnpm workspace's root.
 */
function installLocation(folder: string) {
  const project = nearestAbove(folder, (current) =>
    existsSync(join(current, "package.json"))
  );
  const projectFolder = project ?? folder;
  const lockfile = nearestLockfile(projectFolder);
  const install: ProjectInstall = {
    packageManager: lockfile?.packageManager ?? "npm",
    folder: projectFolder,
    workspaceRoot: existsSync(join(projectFolder, "pnpm-workspace.yaml")),
  };
  return { install, lockfile };
}

/** The lockfile nearest above `folder`, from `folder` itself up, if any. */
function nearestLockfile(folder: string) {
  for (let current = folder; ; current = dirname(current)) {
    const found = LOCKFILES.find(([name]) => existsSync(join(current, name)));
    if (found !== undefined)
      return { folder: current, name: found[0], packageManager: found[1] };
    if (dirname(current) === current) return undefined;
  }
}

function nearestAbove(
  folder: string,
  found: (folder: string) => boolean
): string | undefined {
  for (let current = folder; ; current = dirname(current)) {
    if (found(current)) return current;
    if (dirname(current) === current) return undefined;
  }
}
