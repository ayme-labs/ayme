import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const LOCAL_IMPORT =
  /(?:import|export)\s*(?:[^"']*?\sfrom\s*)?["'](\.\/[^"']+)["']|import\(\s*["'](\.\/[^"']+)["']\s*\)/g;
// Text only the browser runtime carries: the runtime's own and Playwright
// Lite's.
const RUNTIME_MARKERS = [
  "The Ayme browser runtime is not configured.",
  "Target page, context or browser has been closed",
];

/** The built file's code and the code of the chunks it imports. */
function codeOf(file: string, seen = new Set<string>()): string {
  if (seen.has(file)) return "";
  seen.add(file);
  const code = readFileSync(join(dist, file), "utf8");
  return [
    code,
    ...[...code.matchAll(LOCAL_IMPORT)].map((match) =>
      codeOf((match[1] ?? match[2])!.slice(2), seen)
    ),
  ].join("\n");
}

function runtimeMarkersIn(code: string) {
  return RUNTIME_MARKERS.filter((marker) => code.includes(marker));
}

it("the check reads the build: the main entry carries the browser runtime", () => {
  expect(runtimeMarkersIn(codeOf("index.mjs"))).toEqual(RUNTIME_MARKERS);
});

it("the built ./server entry carries no browser runtime", () => {
  const code = codeOf("server.mjs");
  expect(code).toContain("createDecisionEndpoint");
  expect(runtimeMarkersIn(code)).toEqual([]);
});

it("the built ./absent entry carries no browser runtime", () => {
  const code = codeOf("absent.mjs");
  expect(code).toContain("absentPageObject");
  expect(runtimeMarkersIn(code)).toEqual([]);
});

it("the built ./playwright entry carries no browser runtime", () => {
  const code = codeOf("playwright.mjs");
  expect(code).toContain("createInPageHost");
  expect(runtimeMarkersIn(code)).toEqual([]);
});

it("the built ./inspector entry carries no browser runtime", () => {
  const code = codeOf("inspector.mjs");
  expect(code).toContain("mergeInspectorState");
  expect(runtimeMarkersIn(code)).toEqual([]);
});

const TYPESCRIPT_IMPORT =
  /from\s*["']typescript["']|import\(\s*["']typescript["']\s*\)/;

it("the built ./compiler entry carries no browser runtime", () => {
  const code = codeOf("compiler.mjs");
  expect(code).toContain("createPomCompiler");
  expect(code).toMatch(TYPESCRIPT_IMPORT);
  expect(runtimeMarkersIn(code)).toEqual([]);
});

it("only the built ./compiler entry imports TypeScript", () => {
  const entries = [
    "index.mjs",
    "internal.mjs",
    "inspector.mjs",
    "absent.mjs",
    "server.mjs",
    "testing.mjs",
    "playwright.mjs",
  ];
  expect(
    entries.filter((entry) => TYPESCRIPT_IMPORT.test(codeOf(entry)))
  ).toEqual([]);
});
