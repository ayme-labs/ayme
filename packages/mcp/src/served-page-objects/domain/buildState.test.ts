import { expect, it } from "vitest";

import { buildLog, type PageObjectsBuildState } from "./buildState";

const entry = "/project/ayme/page-objects.ts";
const modules = new Map([["entry.js", "good"]]);

it.each<[PageObjectsBuildState, string]>([
  [{ kind: "building", entry }, "Built"],
  [{ kind: "never-built", entry, errors: [] }, "Built"],
  [{ kind: "built", entry, modules }, "Rebuilt"],
  [{ kind: "rebuild-failed", entry, modules, errors: [] }, "Rebuilt"],
])("logs a build after %o as %s", (previous, verb) => {
  expect(buildLog({ kind: "built", entry, modules }, previous)).toBe(
    `${verb} the Page Objects entry ${entry}.`
  );
});
