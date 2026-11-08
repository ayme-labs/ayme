import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { McpServer } from "./arms.ts";
import { aymeSkillSource } from "./ayme.ts";
import { labRoot } from "./paths.ts";
import {
  defaultScenarioId,
  startupScenarios,
  type StartupScenario,
} from "./scenarios.ts";
import { runStartup, type StartupResult } from "./startup.ts";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);
const scenario = startupScenarios[defaultScenarioId];

/**
 * The lane against the stand-in for Claude Code, `src/fixtures/bin/claude`. PATH
 * holds it and Node and nothing else, so no Docker, no browser and no git.
 */
describe("runStartup", () => {
  const runDirs: string[] = [];
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() =>
    Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  );

  async function start(
    fixture: string,
    options: { scenario?: StartupScenario; timeoutMs?: number } = {}
  ) {
    vi.stubEnv(
      "PATH",
      [path.join(fixturesDir, "bin"), path.dirname(process.execPath)].join(
        path.delimiter
      )
    );
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "token-for-the-test");
    vi.stubEnv("FAKE_CLAUDE_TRANSCRIPT", path.join(fixturesDir, fixture));
    const { runDir } = await runStartup({
      scenario: options.scenario ?? scenario,
      model: "sonnet",
      timeoutMs: options.timeoutMs ?? 10_000,
    });
    runDirs.push(runDir);
    const stored = (file: string) => readFile(path.join(runDir, file), "utf8");
    return {
      runDir,
      stored,
      result: JSON.parse(await stored("result.json")) as StartupResult,
    };
  }

  it("passes a run that loads the skill and reads exactly the expected set, and stores it", async () => {
    const { result, stored } = await start("startup-exact.jsonl");
    expect(result.pass).toBe(true);
    expect(result.failed).toEqual([]);
    expect(result.scenario).toBe("drive-the-open-page");
    expect(result.filesRead).toEqual(["references/page-tools.md"]);
    expect(result.wallTimeMs).toEqual(expect.any(Number));
    expect(result.tokens).toEqual({
      input: 5,
      cacheCreation: 8000,
      cacheRead: 2000,
      output: 60,
    });
    expect(await stored("transcript.jsonl")).toContain(
      "skills/ayme/references/page-tools.md"
    );
  });

  it("sends one message, which names the skill and no reference", async () => {
    const { stored } = await start("startup-exact.jsonl");
    const message =
      "Get ready to drive the web page that is already open and connected through Ayme. Load the `ayme` skill now with the Skill tool and read the references it points you to for this work. Read no file outside that skill's folder and don't use the browser; just reply ready.\n";
    expect(await stored("setup-prompt.txt")).toBe(message);
    const stderr = await stored("stderr.log");
    expect(stderr).toContain(`user message 1: ${message}`);
    expect(stderr).not.toContain("user message 2:");
  });

  it("runs in the lab app folder with the skill copied and read-only tools, no MCP server and nothing else readable", async () => {
    const { runDir, stored } = await start("startup-exact.jsonl", {
      scenario: { ...scenario, tools: undefined },
    });
    const stderr = await stored("stderr.log");
    const skillDir = path.join(runDir, "claude-config/skills/ayme");
    expect(stderr).toContain(`started in ${labRoot} with`);
    expect(stderr).toContain(`"--tools","Read,Skill"`);
    expect(stderr).toContain(`"--allowedTools","Skill(ayme)"`);
    expect(stderr).toContain(`"--add-dir","${skillDir}",`);
    expect(stderr).toContain("and skills ayme\n");
    expect(JSON.parse(await stored("mcp.json"))).toEqual({ mcpServers: {} });
    expect(existsSync(path.join(runDir, "claude-config"))).toBe(false);
  });

  it("gives a tool list a stub `ayme` server, which lists those tools and answers a call", async () => {
    const tools = [
      { name: "ayme_list_tools", description: "Lists the tools." },
      { name: "SurveyEditorPage.saveAndClose", description: "Saves." },
    ];
    const { stored, result } = await start("startup-exact.jsonl", {
      scenario: { ...scenario, tools },
    });
    expect(result.pass).toBe(true);
    const { mcpServers } = JSON.parse(await stored("mcp.json")) as {
      mcpServers: Record<string, McpServer>;
    };
    expect(Object.keys(mcpServers)).toEqual(["ayme"]);

    const client = new Client({ name: "the-test", version: "0.0.0" });
    await client.connect(new StdioClientTransport(mcpServers.ayme));
    const listed = await client.listTools();
    expect(
      listed.tools.map(({ name, description }) => ({ name, description }))
    ).toEqual(tools);
    expect(
      await client.callTool({ name: "SurveyEditorPage.saveAndClose" })
    ).toMatchObject({
      content: [
        { type: "text", text: "SurveyEditorPage.saveAndClose is a stub." },
      ],
    });
    await client.close();
  });

  it("fails a run that reads one reference too many", async () => {
    const { result } = await start("startup-extra-reference.jsonl", {
      scenario: { ...scenario, forbidden: [] },
    });
    expect(result.pass).toBe(false);
    expect(result.filesRead).toEqual([
      "references/page-tools.md",
      "references/peeks.md",
    ]);
    expect(result.failed).toEqual([
      {
        condition: "expected-files-read",
        detail:
          "expected references/page-tools.md; read references/page-tools.md, references/peeks.md",
      },
    ]);
  });

  it("names a forbidden reference on its own", async () => {
    const { result } = await start("startup-extra-reference.jsonl", {
      scenario: { ...scenario, forbidden: ["references/peeks.md"] },
    });
    expect(result.failed.map(({ condition }) => condition)).toEqual([
      "expected-files-read",
      "no-forbidden-file",
    ]);
  });

  it("ignores an allowed reference, read or not, and keeps it under the files read", async () => {
    const allowing = {
      ...scenario,
      forbidden: [],
      allowed: ["references/peeks.md"],
    };
    const read = await start("startup-extra-reference.jsonl", {
      scenario: allowing,
    });
    expect(read.result.pass).toBe(true);
    expect(read.result.filesRead).toEqual([
      "references/page-tools.md",
      "references/peeks.md",
    ]);
    const unread = await start("startup-exact.jsonl", { scenario: allowing });
    expect(unread.result.pass).toBe(true);
  });

  it("leaves an allowed reference out of a surplus read's detail", async () => {
    const { result } = await start("startup-extra-reference.jsonl", {
      scenario: {
        ...scenario,
        expected: ["references/goal.md"],
        forbidden: [],
        allowed: ["references/page-tools.md"],
      },
    });
    expect(result.failed).toEqual([
      {
        condition: "expected-files-read",
        detail: "expected references/goal.md; read references/peeks.md",
      },
    ]);
  });

  it("names the driving reference a setup scenario read", async () => {
    const { result } = await start("startup-exact.jsonl", {
      scenario: startupScenarios["set-up-ayme"],
    });
    expect(result.scenario).toBe("set-up-ayme");
    expect(result.failed).toEqual([
      {
        condition: "expected-files-read",
        detail:
          "expected references/onboarding.md, references/runtime-integration.md; read references/page-tools.md",
      },
      {
        condition: "no-forbidden-file",
        detail: "read references/page-tools.md",
      },
    ]);
  });

  it("passes a drive run that reads goal when it is listed", async () => {
    const { result } = await start("startup-drive-goal-listed.jsonl", {
      scenario: startupScenarios["drive-the-open-page-with-goal"],
    });
    expect(result.pass).toBe(true);
    expect(result.filesRead).toEqual([
      "references/page-tools.md",
      "references/goal.md",
    ]);
  });

  it("fails a drive run that reads goal when it is not listed", async () => {
    const { result } = await start("startup-drive-goal-not-listed.jsonl");
    expect(result.failed).toEqual([
      {
        condition: "expected-files-read",
        detail:
          "expected references/page-tools.md; read references/page-tools.md, references/goal.md",
      },
      { condition: "no-forbidden-file", detail: "read references/goal.md" },
    ]);
  });

  it("fails a run that misses an expected reference", async () => {
    const { result } = await start("startup-missing-reference.jsonl");
    expect(result.pass).toBe(false);
    expect(result.filesRead).toEqual([]);
    expect(result.failed).toEqual([
      {
        condition: "expected-files-read",
        detail: "expected references/page-tools.md; read nothing",
      },
    ]);
  });

  it("fails a run that never loads the skill", async () => {
    const { result } = await start("startup-skill-not-loaded.jsonl");
    expect(result.pass).toBe(false);
    expect(result.failed).toEqual([
      {
        condition: "skill-loaded",
        detail: "the Skill tool did not load ayme",
      },
    ]);
  });

  it("fails a run with a denied Read, which does not count as read", async () => {
    const { result } = await start("startup-read-denied.jsonl");
    expect(result.pass).toBe(false);
    expect(result.filesRead).toEqual(["references/page-tools.md"]);
    expect(result.failed).toEqual([
      { condition: "nothing-denied", detail: "permission denials: 1" },
    ]);
  });

  it("fails a run that calls a browser tool", async () => {
    const { result } = await start("startup-browser-tool.jsonl");
    expect(result.pass).toBe(false);
    expect(result.failed).toEqual([
      {
        condition: "no-browser-or-mcp-tool",
        detail: "called mcp__playwright__browser_snapshot",
      },
    ]);
  });

  it("stores a setup turn that runs out of its timeout as a failed run", async () => {
    // The fixture stops after the skill load, with its Read unanswered. The
    // timeout must outlast the stand-in's Node startup, or the skill load is
    // never seen: on a loaded CI runner that startup alone can pass 0.3 s.
    const { result } = await start("startup-hangs.jsonl", {
      timeoutMs: 3_000,
    });
    expect(result.pass).toBe(false);
    expect(result.wallTimeMs).toBeNull();
    expect(result.tokens).toBeNull();
    expect(result.failed).toEqual([
      {
        condition: "expected-files-read",
        detail: "expected references/page-tools.md; read nothing",
      },
      {
        condition: "within-setup-timeout",
        detail: "the setup turn ran out of its 3 s timeout",
      },
    ]);
  });

  it("throws on a setup turn that ends with an error, which says nothing about routing", async () => {
    const error = (await start("setup-failed.jsonl").catch(
      (thrown: unknown) => thrown
    )) as Error;
    expect(error.message).toContain("the setup turn ended with an error");
    // The transcript stays, as for a mission.
    const [, runDir] = /The transcript is in (.*)\.$/.exec(error.message) ?? [];
    runDirs.push(runDir);
    expect(existsSync(path.join(runDir, "transcript.jsonl"))).toBe(true);
    expect(existsSync(path.join(runDir, "result.json"))).toBe(false);
  });

  it("names Claude Code as the missing precondition, and nothing else", async () => {
    // A folder with nothing in it: Node's own folder may hold a claude beside node, as a Claude Code cloud container's does.
    const emptyBin = await mkdtemp(path.join(os.tmpdir(), "eval-no-claude-"));
    runDirs.push(emptyBin);
    vi.stubEnv("PATH", emptyBin);
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "token-for-the-test");
    await expect(
      runStartup({ scenario, model: "sonnet", timeoutMs: 10_000 })
    ).rejects.toThrow(
      "Cannot start the run:\n- Claude Code token: Claude Code is not installed: `claude --version` failed."
    );
  });
});

describe("the startup scenarios", () => {
  it.each(Object.values(startupScenarios))(
    "$id names references the skill ships, with expected, forbidden and allowed apart",
    ({ expected, forbidden = [], allowed = [] }) => {
      const references = [...expected, ...forbidden, ...allowed];
      for (const reference of references)
        expect(existsSync(path.join(aymeSkillSource, reference))).toBe(true);
      expect(new Set(references).size).toBe(references.length);
    }
  );
});
