/**
 * What a suite leaves on disk and how it is read back. A suite folder under
 * `results/suites/` holds a manifest naming the runs that belong to it; the
 * runs themselves stay in `results/runs/`. Reading validates the shape, so a
 * hand-edited or older file fails with its name instead of a wrong number.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { repoRoot, runsRoot, suitesRoot } from "./paths.ts";
import type { SuiteSummary, SummarizedRun } from "./summary.ts";
import { renderSummaryMarkdown } from "./summary.ts";

export type SuiteManifest = {
  suiteId: string;
  startedAt: string;
  finishedAt: string | null;
  model: string;
  timeoutSeconds: number;
  mission: string;
  /** In the order they were asked for. */
  arms: string[];
  runsPerArm: number;
  /** The runs that stored a result, in the order they finished. */
  runIds: string[];
  /** Why the suite stopped early, when it did. */
  error: string | null;
};

type Json = Record<string, unknown>;

function record(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`${what}: expected an object`);
  return value as Json;
}

function string(value: Json, key: string, what: string) {
  const property = value[key];
  if (typeof property !== "string")
    throw new TypeError(`${what}: expected string ${key}`);
  return property;
}

function nullableString(value: Json, key: string, what: string) {
  const property = value[key];
  if (property === null || property === undefined) return null;
  if (typeof property !== "string")
    throw new TypeError(`${what}: expected string or null ${key}`);
  return property;
}

function number(value: Json, key: string, what: string) {
  const property = value[key];
  if (typeof property !== "number")
    throw new TypeError(`${what}: expected number ${key}`);
  return property;
}

function nullableNumber(value: Json, key: string, what: string) {
  const property = value[key];
  if (property === null || property === undefined) return null;
  if (typeof property !== "number")
    throw new TypeError(`${what}: expected number or null ${key}`);
  return property;
}

function boolean(value: Json, key: string, what: string) {
  const property = value[key];
  if (typeof property !== "boolean")
    throw new TypeError(`${what}: expected boolean ${key}`);
  return property;
}

function strings(value: Json, key: string, what: string) {
  const property = value[key];
  if (
    !Array.isArray(property) ||
    property.some((item) => typeof item !== "string")
  )
    throw new TypeError(`${what}: expected a list of strings ${key}`);
  return property as string[];
}

/** Reads the part of a stored `result.json` the summary needs. */
export function parseStoredRun(value: unknown, what: string): SummarizedRun {
  const run = record(value, what);
  const versions = record(run.versions, `${what} versions`);
  const model = record(versions.model, `${what} model`);
  const browserInterface = record(
    versions.browserInterface,
    `${what} browserInterface`
  );
  const tokens =
    run.tokens === null || run.tokens === undefined
      ? null
      : record(run.tokens, `${what} tokens`);
  return {
    runId: string(run, "runId", what),
    arm: string(run, "arm", what),
    mission: string(run, "mission", what),
    pass: boolean(run, "pass", what),
    wallTimeMs: nullableNumber(run, "wallTimeMs", what),
    tokens:
      tokens === null
        ? null
        : {
            input: number(tokens, "input", `${what} tokens`),
            cacheCreation: number(tokens, "cacheCreation", `${what} tokens`),
            cacheRead: number(tokens, "cacheRead", `${what} tokens`),
            output: number(tokens, "output", `${what} tokens`),
          },
    combinedCostUsd: nullableNumber(run, "combinedCostUsd", what),
    timeoutSeconds: number(run, "timeoutSeconds", what),
    labCheckoutDirty: boolean(run, "labCheckoutDirty", what),
    versions: {
      claudeCode: nullableString(versions, "claudeCode", `${what} versions`),
      model: {
        requested: string(model, "requested", `${what} model`),
        used: nullableString(model, "used", `${what} model`),
      },
      browserInterface: {
        name: string(browserInterface, "name", `${what} browserInterface`),
        version: string(
          browserInterface,
          "version",
          `${what} browserInterface`
        ),
      },
      browser: nullableString(versions, "browser", `${what} versions`),
      formbricksCommit: nullableString(
        versions,
        "formbricksCommit",
        `${what} versions`
      ),
      aymeCommit: nullableString(versions, "aymeCommit", `${what} versions`),
    },
  };
}

export function parseSuiteManifest(value: unknown): SuiteManifest {
  const what = "Suite manifest";
  const manifest = record(value, what);
  return {
    suiteId: string(manifest, "suiteId", what),
    startedAt: string(manifest, "startedAt", what),
    finishedAt: nullableString(manifest, "finishedAt", what),
    model: string(manifest, "model", what),
    timeoutSeconds: number(manifest, "timeoutSeconds", what),
    mission: string(manifest, "mission", what),
    arms: strings(manifest, "arms", what),
    runsPerArm: number(manifest, "runsPerArm", what),
    runIds: strings(manifest, "runIds", what),
    error: nullableString(manifest, "error", what),
  };
}

export function suiteDirectory(suiteId: string) {
  return path.join(suitesRoot, suiteId);
}

export async function writeManifest(manifest: SuiteManifest) {
  const directory = suiteDirectory(manifest.suiteId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "suite.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

/** The newest suite by id; ids start with a timestamp. */
export async function latestSuiteId(): Promise<string | null> {
  const entries = await readdir(suitesRoot, { withFileTypes: true }).catch(
    () => []
  );
  const ids = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return ids.at(-1) ?? null;
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

/** The manifest and the stored result of each run it lists. */
export async function readSuite(suiteId: string): Promise<{
  manifest: SuiteManifest;
  results: SummarizedRun[];
}> {
  const manifest = parseSuiteManifest(
    await readJson(path.join(suiteDirectory(suiteId), "suite.json"))
  );
  const results: SummarizedRun[] = [];
  for (const runId of manifest.runIds) {
    const file = path.join(runsRoot, runId, "result.json");
    results.push(parseStoredRun(await readJson(file), file));
  }
  return { manifest, results };
}

type Prettier = {
  resolveConfig(filePath: string): Promise<object | null>;
  format(source: string, options: object): Promise<string>;
};

/**
 * The summary is meant to be committed, and the repo checks formatting, so it
 * is written the way the repo's Prettier formats it. Prettier is the root's
 * own tool, loaded from there rather than declared as a dependency here.
 */
async function formatLikeTheRepo(filePath: string, source: string) {
  const prettier = createRequire(path.join(repoRoot, "package.json"))(
    "prettier"
  ) as Prettier;
  const config = await prettier.resolveConfig(filePath);
  return prettier.format(source, { ...config, filepath: filePath });
}

/** `summary.md` and `summary.json` in `directory`, created when missing. */
export async function writeSummaryFiles(
  directory: string,
  summary: SuiteSummary
) {
  await mkdir(directory, { recursive: true });
  const files = [
    ["summary.json", `${JSON.stringify(summary, null, 2)}\n`],
    ["summary.md", renderSummaryMarkdown(summary)],
  ] as const;
  for (const [name, source] of files) {
    const filePath = path.join(directory, name);
    await writeFile(filePath, await formatLikeTheRepo(filePath, source));
  }
}
