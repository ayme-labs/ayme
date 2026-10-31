import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { runsRoot } from "./paths.ts";
import { startupScenarios, type StartupScenario } from "./scenarios.ts";
import type { StartupResult } from "./startup.ts";
import { parseStartupSuiteOptions, runStartupSuite } from "./startupSuite.ts";
import { suiteDirectory, type StartupManifest } from "./store.ts";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

/** Named after the fixture it replays, which the stand-in finds through the run's folder. */
const replaying = (fixture: string): StartupScenario => ({
  id: fixture,
  framing: "Get ready.",
  expected: ["references/page-tools.md"],
});

/** The suite against the stand-in for Claude Code, as the lane's own tests run it. */
describe("runStartupSuite", () => {
  const folders: string[] = [];
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() =>
    Promise.all(folders.map((dir) => rm(dir, { recursive: true, force: true })))
  );

  async function start(scenarios: StartupScenario[], runsPerScenario: number) {
    vi.stubEnv(
      "PATH",
      [path.join(fixturesDir, "bin"), path.dirname(process.execPath)].join(
        path.delimiter
      )
    );
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "token-for-the-test");
    vi.stubEnv(
      "FAKE_CLAUDE_TRANSCRIPT",
      path.join(fixturesDir, "{scenario}.jsonl")
    );
    const { manifest, markdown } = await runStartupSuite({
      scenarios,
      runsPerScenario,
      model: "sonnet",
      timeoutMs: 10_000,
    });
    const suiteDir = suiteDirectory(manifest.suiteId);
    folders.push(
      suiteDir,
      ...manifest.runIds.map((runId) => path.join(runsRoot, runId))
    );
    const stored = JSON.parse(
      await readFile(path.join(suiteDir, "suite.json"), "utf8")
    ) as StartupManifest;
    return { stored, markdown };
  }

  const results = (manifest: StartupManifest) =>
    Promise.all(
      manifest.runIds.map(
        async (runId) =>
          JSON.parse(
            await readFile(path.join(runsRoot, runId, "result.json"), "utf8")
          ) as StartupResult
      )
    );

  it("runs round-robin, stores its manifest and summarizes per scenario", async () => {
    const { stored, markdown } = await start(
      [replaying("startup-exact"), replaying("startup-extra-reference")],
      2
    );
    expect(stored).toMatchObject({
      lane: "startup",
      model: "sonnet",
      timeoutSeconds: 10,
      scenarios: ["startup-exact", "startup-extra-reference"],
      runsPerScenario: 2,
      error: null,
    });
    expect(stored.finishedAt).toEqual(expect.any(String));
    expect((await results(stored)).map(({ scenario }) => scenario)).toEqual([
      "startup-exact",
      "startup-extra-reference",
      "startup-exact",
      "startup-extra-reference",
    ]);
    expect(markdown).toContain("| startup-exact | 2 of 2 |");
    expect(markdown).toContain("| startup-extra-reference | 0 of 2 |");
    expect(markdown).toContain(
      "| startup-extra-reference | references/peeks.md | 2 of 2 |"
    );
  });

  it("keeps going past a failed verdict, which is a result", async () => {
    const { stored } = await start([replaying("startup-read-denied")], 2);
    expect(stored.error).toBeNull();
    expect(stored.runIds).toHaveLength(2);
  });

  it("ends at the first run that cannot complete and still summarizes what it holds", async () => {
    const { stored, markdown } = await start(
      [replaying("startup-exact"), replaying("setup-failed")],
      2
    );
    const [, failedRunDir] =
      /The transcript is in (.*)\.$/.exec(stored.error ?? "") ?? [];
    folders.push(failedRunDir ?? "");
    expect(stored.error).toContain("the setup turn ended with an error");
    expect(stored.finishedAt).toEqual(expect.any(String));
    expect((await results(stored)).map(({ scenario }) => scenario)).toEqual([
      "startup-exact",
    ]);
    expect(markdown).toContain("The suite stopped early:");
    expect(markdown).toContain("| startup-exact | 1 of 1 |");
    expect(markdown).toContain("startup-exact: 1 of 2 requested runs");
    expect(markdown).toContain("setup-failed: 0 of 2 requested runs");
  });
});

describe("the startup suite options", () => {
  it("default to every scenario, three runs each and Sonnet", () => {
    const options = parseStartupSuiteOptions([]);
    expect(options.scenarios).toEqual(Object.values(startupScenarios));
    expect(options.runsPerScenario).toBe(3);
    expect(options.model).toBe("sonnet");
    expect(options.timeoutMs).toBe(120_000);
  });

  it("take the run count and model from the flags", () => {
    const options = parseStartupSuiteOptions([
      "--",
      "--runs",
      "10",
      "--model",
      "opus",
    ]);
    expect(options.runsPerScenario).toBe(10);
    expect(options.model).toBe("opus");
  });

  it.each([
    ["a run count of zero", ["--runs", "0"]],
    ["a fractional run count", ["--runs", "1.5"]],
    ["a flag without a value", ["--runs"]],
  ])("reject %s", (_, argv) => {
    expect(() => parseStartupSuiteOptions(argv)).toThrow(
      "Usage: pnpm eval:startup-suite"
    );
  });
});
