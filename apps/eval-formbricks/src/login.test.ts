import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { arms } from "./arms.ts";
import {
  claudeEnvironment,
  runClaude,
  type ClaudeInvocation,
  type ClaudeRun,
} from "./claude.ts";
import {
  readLogins,
  usageLimitError,
  withFallbackLogin,
  type Login,
} from "./login.ts";
import { isUsageLimitText } from "./transcript.ts";

const firstToken = "first-token-text-9f3a";
const fallbackToken = "fallback-token-text-77c1";

describe("isUsageLimitText", () => {
  it("matches Claude Code's usage-limit wordings", () => {
    for (const text of [
      "You've hit your weekly limit · resets Nov 20, 9am (UTC)",
      "You've hit your session limit · resets 3pm",
      "You've hit your Opus limit",
      "You've hit your monthly spend limit.",
    ])
      expect(isUsageLimitText(text)).toBe(true);
  });

  it("leaves other errors and rate limits alone", () => {
    for (const text of [
      "API Error: 529 overloaded",
      "Server is temporarily limiting requests (not your usage limit)",
      "Opus is experiencing high load, please use /model to switch to Sonnet",
      "Done. You've hit your target.",
      "I told you: You've hit your weekly limit",
    ])
      expect(isUsageLimitText(text)).toBe(false);
  });
});

describe("readLogins", () => {
  it("has the first login alone when no second token is configured", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "eval-login-"));
    try {
      expect(
        readLogins(directory, { CLAUDE_CODE_OAUTH_TOKEN: firstToken })
      ).toEqual([{ name: "first", token: firstToken, hasNext: false }]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("adds the fallback from the shell or the env file, the shell first", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "eval-login-"));
    try {
      await writeFile(
        path.join(directory, ".env.local"),
        "CLAUDE_CODE_OAUTH_TOKEN_FALLBACK=from-file\n"
      );
      expect(
        readLogins(directory, { CLAUDE_CODE_OAUTH_TOKEN: firstToken })
      ).toEqual([
        { name: "first", token: firstToken, hasNext: true },
        { name: "fallback", token: "from-file", hasNext: false },
      ]);
      expect(
        readLogins(directory, {
          CLAUDE_CODE_OAUTH_TOKEN: firstToken,
          CLAUDE_CODE_OAUTH_TOKEN_FALLBACK: fallbackToken,
        })[1]?.token
      ).toBe(fallbackToken);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

/**
 * Each attempt is one driver run against the stand-in `claude`, whose
 * fixture depends on the login: what the real harness does around
 * `runClaude`, with the same two helpers.
 */
describe("a run across two logins", () => {
  const fixturesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures"
  );
  const workDirs: string[] = [];
  afterAll(() =>
    Promise.all(workDirs.map((dir) => rm(dir, { recursive: true })))
  );

  const logins = (hasFallback: boolean): Login[] => [
    { name: "first", token: firstToken, hasNext: hasFallback },
    ...(hasFallback
      ? [{ name: "fallback" as const, token: fallbackToken, hasNext: false }]
      : []),
  ];

  /** Runs the driver once per login the helper asks for; returns the run it ended on and each attempt's folder. */
  async function runAcross(
    fixtureOf: Record<"first" | "fallback", string>,
    hasFallback = true
  ) {
    const attempts: { login: string; workDir: string }[] = [];
    const run = await withFallbackLogin(
      logins(hasFallback),
      async (login) => {
        const workDir = await mkdtemp(path.join(os.tmpdir(), "eval-login-"));
        workDirs.push(workDir);
        attempts.push({ login: login.name, workDir });
        const run: ClaudeRun = await runClaude({
          cwd: workDir,
          environment: {
            PATH: [
              path.join(fixturesDir, "bin"),
              path.dirname(process.execPath),
            ].join(path.delimiter),
            ...claudeEnvironment(
              {
                configDir: path.join(workDir, "claude-config"),
                oauthToken: login.token!,
              },
              {}
            ),
            FAKE_CLAUDE_TRANSCRIPT: path.join(
              fixturesDir,
              fixtureOf[login.name]
            ),
          },
          model: "sonnet",
          arm: arms["playwright-mcp"],
          mcpConfigPath: path.join(workDir, "mcp.json"),
          setupPrompt: "Get ready and reply ready.",
          prompt: "Rename the survey.",
          timeoutMs: 10_000,
          setupTimeoutMs: 10_000,
          transcriptPath: path.join(workDir, "transcript.jsonl"),
          stderrPath: path.join(workDir, "stderr.log"),
        } as ClaudeInvocation);
        const limited = usageLimitError(run, login, workDir);
        if (limited !== null) throw limited;
        return { run, login: login.name };
      },
      () => undefined
    );
    return { ...run, attempts };
  }

  it("repeats the run on the fallback login when the first is limited in the setup turn", async () => {
    const { run, login, attempts } = await runAcross({
      first: "limit-in-setup.jsonl",
      fallback: "complete.jsonl",
    });
    expect(attempts.map((a) => a.login)).toEqual(["first", "fallback"]);
    expect(login).toBe("fallback");
    expect(run.task).not.toBeNull();
    expect(run.usageLimited).toBe(false);
  });

  it("throws the whole attempt away when the first login is limited in the task turn", async () => {
    const { run, login, attempts } = await runAcross({
      first: "limit-in-task.jsonl",
      fallback: "complete.jsonl",
    });
    expect(attempts.map((a) => a.login)).toEqual(["first", "fallback"]);
    expect(login).toBe("fallback");
    // The kept run is the fallback's whole run, both turns, none of the first's.
    expect(run.lines).toHaveLength(16);
    expect(run.task?.wallTimeMs).not.toBeNull();
  });

  it("uses the first login alone when it is not limited", async () => {
    const { login, attempts } = await runAcross({
      first: "complete.jsonl",
      fallback: "limit-in-setup.jsonl",
    });
    expect(attempts.map((a) => a.login)).toEqual(["first"]);
    expect(login).toBe("first");
  });

  it("stops with a message that names both logins when both are limited", async () => {
    const error = await runAcross({
      first: "limit-in-setup.jsonl",
      fallback: "limit-in-task.jsonl",
    }).catch((caught: unknown) => caught as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /^Both Claude Code logins are at their usage limit/
    );
  });

  it("handles a limit as it does today when no second token is configured", async () => {
    const { run, login, attempts } = await runAcross(
      { first: "limit-in-setup.jsonl", fallback: "complete.jsonl" },
      false
    );
    expect(attempts.map((a) => a.login)).toEqual(["first"]);
    expect(login).toBe("first");
    expect(run.setupFailure).toBe("the setup turn ended with an error");
    expect(run.task).toBeNull();
  });

  it("writes no token, or part of one, to any file of any attempt", async () => {
    const { attempts } = await runAcross({
      first: "limit-in-task.jsonl",
      fallback: "complete.jsonl",
    });
    for (const { workDir } of attempts)
      for (const file of ["transcript.jsonl", "stderr.log"]) {
        const text = await readFile(path.join(workDir, file), "utf8");
        for (const token of [firstToken, fallbackToken]) {
          expect(text).not.toContain(token);
          expect(text).not.toContain(token.slice(0, 12));
        }
      }
    expect(await readdir(attempts[0]!.workDir)).toContain("transcript.jsonl");
  });
});
