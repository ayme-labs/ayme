/**
 * What the patched e2e adds, as this package uses it. The patches in
 * `../patches` change e2e's JavaScript only, as `e2e-patched` loads it, so
 * the installed e2e and its types stay the published ones; this is their
 * one typed view.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { JsonValue, StepExecutorContext } from "e2e";

/** What `patched-e2e/register.mjs` publishes: each patched package and the files its patch names. */
type Patched = readonly {
  readonly name: string;
  readonly version: string;
  readonly files: readonly string[];
}[];

const registered = (): Patched | undefined =>
  (globalThis as Record<symbol, Patched | undefined>)[
    Symbol.for("@ayme-dev/e2e-tools.patched-e2e")
  ];

/** The installed package `name` as e2e loads it: from this project, else from e2e's own folder. */
function packageRoot(name: string): string {
  const project = createRequire(path.join(process.cwd(), "package.json"));
  let entry: string;
  try {
    entry = project.resolve(name);
  } catch {
    entry = createRequire(project.resolve("e2e")).resolve(name);
  }
  for (let dir = path.dirname(realpathSync(entry)); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (
      existsSync(manifest) &&
      (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name ===
        name
    )
      return dir;
    if (path.dirname(dir) === dir)
      throw new Error(`no ${name} package above ${entry}`);
  }
}

/**
 * Throws unless this process runs e2e patched: under `e2e-patched`, with
 * every file a patch names loaded through the hook. Each such file is loaded
 * now if it is not yet, so the copy e2e uses later is the patched one; a
 * file loaded before the hook, or a hunk that does not match, fails here. A
 * config that needs the patches awaits it, so a plain `e2e run` of it stops
 * at once instead of failing on the first call.
 */
export async function assertPatchedE2e(config: string): Promise<void> {
  const patched = registered();
  if (patched === undefined)
    throw new Error(
      `${config} needs the patched e2e: run it with e2e-patched (@ayme-dev/e2e-tools), not e2e`
    );
  const unpatched: string[] = [];
  for (const { name, files } of patched) {
    const root = packageRoot(name);
    for (const file of files) {
      const full = path.join(root, file);
      await import(pathToFileURL(full).href);
      const marked = (globalThis as Record<symbol, Set<string> | undefined>)[
        Symbol.for("@ayme-dev/e2e-tools.patched-files")
      ];
      if (!marked?.has(full)) unpatched.push(`${name}/${file}`);
    }
  }
  if (unpatched.length > 0)
    throw new Error(
      `${config}: these files run unpatched, loaded before the patching hook or from another copy: ${unpatched.join(", ")}`
    );
}

const IMPORTING_BASELINE = Symbol.for("@ayme-dev/e2e-tools.importing-baseline");

/**
 * Imports a baseline arm's config for its settings, from an arm 3 config
 * that has passed `assertPatchedE2e`: the baseline's `assertUnpatchedE2e`
 * lets this one import through, so arm 3 runs on the baseline's settings.
 */
export async function importBaseline<Module>(
  load: () => Promise<Module>
): Promise<Module> {
  if (registered() === undefined)
    throw new Error("importBaseline is for an arm 3 config, under e2e-patched");
  const flags = globalThis as Record<symbol, boolean | undefined>;
  flags[IMPORTING_BASELINE] = true;
  try {
    return await load();
  } finally {
    delete flags[IMPORTING_BASELINE];
  }
}

/**
 * Throws if this process runs e2e patched, or would start its test workers
 * patched: a baseline config calls it, so an environment that carries the
 * hook in NODE_OPTIONS cannot run a baseline arm on the patched e2e. An arm 3
 * config reading the baseline's settings through `importBaseline` passes.
 */
export function assertUnpatchedE2e(config: string): void {
  if ((globalThis as Record<symbol, unknown>)[IMPORTING_BASELINE] === true)
    return;
  if (
    registered() !== undefined ||
    /patched-e2e[\\/]register\.mjs/.test(process.env.NODE_OPTIONS ?? "")
  )
    throw new Error(
      `${config} runs e2e as published, but this run patches it: start it with e2e, without e2e-patched or its hook in NODE_OPTIONS`
    );
}

/** The `--cache-dir` this run was started with, if any. */
function cacheDirFlag(): string | undefined {
  const args = process.argv;
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg === "--cache-dir") return args[at + 1];
    if (arg.startsWith("--cache-dir=")) return arg.slice("--cache-dir=".length);
  }
  return undefined;
}

/**
 * Throws if this run's replay cache is one a baseline config uses, as e2e
 * picks it: `--cache-dir`, else `E2E_CACHE_DIR`, else `cache.dir`, else
 * `.e2e/cache`, from the project root. An arm 3 config calls it, so its
 * recordings never mix with, or replay, a baseline arm's.
 */
export function assertOwnCacheDir(
  config: string,
  projectRoot: string,
  own: string | undefined,
  /** The baseline arms' configs, whose `cache.dir` (or e2e's default) is taken. */
  baselineConfigs: readonly object[]
): void {
  const baselines = baselineConfigs.map(
    (baseline) => (baseline as { cache?: { dir?: string } }).cache?.dir
  );
  const resolve = (dir: string) =>
    path.resolve(projectRoot, dir.replace(/^~(?=$|\/)/, homedir()));
  const env = process.env.E2E_CACHE_DIR;
  const dir = resolve(cacheDirFlag() ?? env ?? own ?? ".e2e/cache");
  if (
    baselines.some(
      (baseline) => resolve(env ?? baseline ?? ".e2e/cache") === dir
    )
  )
    throw new Error(
      `${config} would replay from ${dir}, which a baseline arm's config uses: give it a directory of its own`
    );
}

/** The step's tool accounting, with the input a call can be repeated with. */
export type PatchedBudgets = {
  runTool<T>(
    call: { name: string; mutates: boolean; replay?: { input: JsonValue } },
    body: () => Promise<T>
  ): Promise<T>;
};

/** `ctx.budgets` as the patched e2e takes it. */
export const budgetsOf = (ctx: StepExecutorContext): PatchedBudgets =>
  ctx.budgets as PatchedBudgets;

/** The newest attempt's `screen` and fixtures, which the patched e2e keeps for project tools. */
export type PatchedScreens = {
  readonly current: object;
  readonly fixtures: Record<string, unknown>;
};

export const patchedScreens = (): PatchedScreens | undefined =>
  (globalThis as Record<symbol, PatchedScreens | undefined>)[
    Symbol.for("e2e.patch.screens")
  ];

/** One tool of the patched `@e2e-dev/acp`'s `tools` option (`AcpExtraTool` there). */
export interface ServedTool {
  readonly name: string;
  readonly description: string;
  /** A zod object schema, as the ACP executor's MCP server registers it. */
  readonly inputSchema: unknown;
  readonly readOnly: boolean;
  /** When set, the tool is listed only while this answers false (`hidden` in the ACP patch). */
  readonly hidden?: (ctx: StepExecutorContext) => boolean | Promise<boolean>;
  run(
    args: unknown,
    step: {
      readonly ctx: StepExecutorContext;
      /** e2e's view of the screen: what changed since the agent last saw it. */
      observe(): Promise<string>;
      /** Set when a cached replay repeats the call. */
      readonly replaying?: boolean;
    }
  ): Promise<string>;
}
