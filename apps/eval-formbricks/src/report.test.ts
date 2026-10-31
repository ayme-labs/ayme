import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { runsRoot, summariesRoot } from "./paths.ts";
import { publishedFolder, reportSuite } from "./report.ts";
import {
  suiteDirectory,
  writeManifest,
  type StartupManifest,
} from "./store.ts";

describe("the published summary's folder", () => {
  it("is the date for the default mission", () => {
    expect(
      publishedFolder({
        date: "2026-10-06",
        missions: ["rename-survey-and-question"],
      })
    ).toBe("2026-10-06");
  });

  it("adds the mission for any other mission, so it never overwrites the default mission's table", () => {
    expect(
      publishedFolder({
        date: "2026-10-06",
        missions: ["sign-in-create-and-revise-survey"],
      })
    ).toBe("2026-10-06-sign-in-create-and-revise-survey");
  });
});

describe("a stored startup suite", () => {
  // A day no real suite has, since publishing writes under the committed `summaries/`.
  const date = "2000-01-02";
  const published = path.join(summariesRoot, `${date}-startup`);
  const folders = [published];
  afterAll(() =>
    Promise.all(folders.map((dir) => rm(dir, { recursive: true, force: true })))
  );

  async function store(
    runs: { scenario: string; pass: boolean; filesRead: string[] }[],
    manifest: Partial<StartupManifest> = {}
  ) {
    const unique = randomBytes(3).toString("hex");
    const suiteId = `test-startup-suite-${unique}`;
    const runIds = runs.map((_, index) => `test-startup-${unique}-${index}`);
    folders.push(suiteDirectory(suiteId));
    await Promise.all(
      runs.map(async (run, index) => {
        const runId = runIds[index] ?? "";
        const runDir = path.join(runsRoot, runId);
        folders.push(runDir);
        await mkdir(runDir, { recursive: true });
        await writeFile(
          path.join(runDir, "result.json"),
          JSON.stringify({
            ...run,
            runId,
            failed: [],
            wallTimeMs: 1000 * (index + 1),
            tokens: {
              input: 1,
              cacheCreation: 10,
              cacheRead: 100,
              output: 1000,
            },
            timeoutSeconds: 120,
            versions: {
              claudeCode: "2.1.281",
              model: {
                requested: "sonnet",
                used: "claude-sonnet-fixture",
                effort: "medium",
              },
              aymeCommit: "4cdac8dd",
            },
            startedAt: `${date}T10:00:00.000Z`,
            finishedAt: `${date}T10:00:10.000Z`,
          })
        );
      })
    );
    await writeManifest({
      lane: "startup",
      suiteId,
      startedAt: `${date}T10:00:00.000Z`,
      finishedAt: `${date}T10:05:00.000Z`,
      model: "sonnet",
      timeoutSeconds: 120,
      scenarios: ["drive-the-open-page", "set-up-ayme"],
      runsPerScenario: 1,
      runIds,
      error: null,
      ...manifest,
    });
    return suiteId;
  }

  const report = (suiteId: string, publish: boolean) =>
    reportSuite(suiteId, { publish, openRouterApiKey: undefined });

  it("rebuilds the per-scenario summary beside its manifest, without publishing", async () => {
    const suiteId = await store([
      {
        scenario: "drive-the-open-page",
        pass: true,
        filesRead: ["references/page-tools.md"],
      },
      {
        scenario: "set-up-ayme",
        pass: false,
        filesRead: ["references/onboarding.md", "references/page-tools.md"],
      },
    ]);
    const { markdown, written } = await report(suiteId, false);
    const folder = suiteDirectory(suiteId);
    expect(written).toEqual([folder]);
    expect(markdown).toContain("# Startup lane summary, 2000-01-02");
    expect(markdown).toContain("| drive-the-open-page | 1 of 1 | 1.0 s");
    expect(markdown).toContain("| set-up-ayme | 0 of 1 | 2.0 s");
    expect(markdown).toContain(
      "| set-up-ayme | references/page-tools.md | 1 of 1 |"
    );
    const stored = JSON.parse(
      await readFile(path.join(folder, "summary.json"), "utf8")
    ) as { scenarios: { scenario: string; passes: number }[] };
    expect(
      stored.scenarios.map(({ scenario, passes }) => [scenario, passes])
    ).toEqual([
      ["drive-the-open-page", 1],
      ["set-up-ayme", 0],
    ]);
  });

  it("publishes in a folder of its own, beside the day's Formbricks summary", async () => {
    const suiteId = await store([
      {
        scenario: "drive-the-open-page",
        pass: true,
        filesRead: ["references/page-tools.md"],
      },
    ]);
    const { written } = await report(suiteId, true);
    expect(written).toContain(published);
    expect(
      await readFile(path.join(published, "summary.md"), "utf8")
    ).toContain("# Startup lane summary, 2000-01-02");
  });

  it("says when the suite stopped early and what it holds", async () => {
    const suiteId = await store(
      [
        {
          scenario: "drive-the-open-page",
          pass: true,
          filesRead: ["references/page-tools.md"],
        },
      ],
      { error: "The run could not complete", runsPerScenario: 2 }
    );
    const { markdown } = await report(suiteId, false);
    expect(markdown).toContain(
      "- The suite stopped early: The run could not complete"
    );
    expect(markdown).toContain(
      "- drive-the-open-page: 1 of 2 requested runs were stored."
    );
  });

  it("names the file and field of a result it cannot read", async () => {
    const suiteId = await store([
      {
        scenario: "drive-the-open-page",
        pass: "yes" as unknown as boolean,
        filesRead: [],
      },
    ]);
    await expect(report(suiteId, false)).rejects.toThrow(
      "result.json: expected boolean pass"
    );
  });
});
