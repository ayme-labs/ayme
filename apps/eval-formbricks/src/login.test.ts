import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { arms } from "./arms.ts";
import {
  claudeEnvironment,
  runClaude,
  type ClaudeInvocation,
} from "./claude.ts";
import {
  UsageLimitError,
  usageLimitError,
  withFallbackLogin,
  type Login,
} from "./login.ts";
import { runsRoot } from "./paths.ts";
import { defaultScenarioId, startupScenarios } from "./scenarios.ts";
import { runStartup, type StartupResult } from "./startup.ts";
import { isUsageLimitText } from "./transcript.ts";

const firstToken = "first-token-text-9f3a";
const fallbackToken = "fallback-token-text-77c1";
const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

describe("isUsageLimitText", () => {
  it("matches the texts Claude Code 2.1.281 gives for an exhausted login", () => {
    for (const text of [
      "You've hit your weekly limit · resets Nov 20, 9am (UTC)",
      "You've hit your session limit · resets 3pm",
      "You've hit your Opus limit",
      "You've hit your limit · resets 3pm",
      "You've hit your usage limit.",
      "You've hit your monthly spend limit.",
      "You've hit your channel's monthly spend limit.",
      "You've hit your team's shared budget. /model to switch models.",
      "You've reached your Fable limit.",
      "You're out of usage credits · resets Nov 20 · progress saved",
      "You're out of usage credits. /model to switch models.",
      "You're out of extra usage",
      "Your org is out of usage · add funds to continue",
      "Your org is out of usage · contact your admin",
      "Your seat type doesn't include usage credits",
      "Your usage allocation has been disabled by your admin",
      "Your group's usage limit is set to $0",
    ])
      expect(isUsageLimitText(text), text).toBe(true);
  });

  it("leaves overload, other errors and quoted texts alone", () => {
    for (const text of [
      "API Error: 529 overloaded",
      "Server is temporarily limiting requests (not your usage limit)",
      "Opus is experiencing high load, please use /model to switch to Sonnet",
      "This service is disabled for your org",
      "Done. You've hit your target.",
      "I told you: You've hit your weekly limit",
      "Fable 5 requires usage credits.",
    ])
      expect(isUsageLimitText(text), text).toBe(false);
  });
});

describe("usageLimitError", () => {
  const login = (overrides: Partial<Login>): Login => ({
    name: "first",
    variable: "CLAUDE_CODE_OAUTH_TOKEN",
    token: firstToken,
    secrets: [firstToken],
    hasFallback: false,
    ...overrides,
  });

  it("is silent when the attempt did not hit a limit", () => {
    expect(usageLimitError({ usageLimited: false }, login({}), "x")).toBeNull();
  });

  it("leaves a limit on a first login without a fallback to the run's ordinary handling", () => {
    expect(usageLimitError({ usageLimited: true }, login({}), "x")).toBeNull();
  });

  it("asks for the repeat on a limited first login that has a fallback", () => {
    expect(
      usageLimitError({ usageLimited: true }, login({ hasFallback: true }), "x")
    ).toBeInstanceOf(UsageLimitError);
  });

  it("says that both logins are limited when the fallback is too", () => {
    const error = usageLimitError(
      { usageLimited: true },
      login({ name: "fallback" }),
      "/runs/a"
    );
    expect(error).not.toBeInstanceOf(UsageLimitError);
    expect(error?.message).toBe(
      "Both Claude Code logins are at their usage limit, so the run cannot complete. The transcript is in /runs/a."
    );
  });
});

describe("withFallbackLogin", () => {
  it("runs the first login alone, without a second token", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "eval-login-"));
    try {
      const attempts: Login[] = [];
      await withFallbackLogin(
        directory,
        (login) => {
          attempts.push(login);
          return Promise.resolve();
        },
        () => undefined,
        { CLAUDE_CODE_OAUTH_TOKEN: firstToken }
      );
      expect(attempts).toEqual([
        {
          name: "first",
          variable: "CLAUDE_CODE_OAUTH_TOKEN",
          token: firstToken,
          secrets: [firstToken],
          hasFallback: false,
        },
      ]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("repeats on the fallback token, from the env file when the shell has none", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "eval-login-"));
    try {
      await writeFile(
        path.join(directory, ".env.local"),
        `CLAUDE_CODE_OAUTH_TOKEN_FALLBACK=${fallbackToken}\n`
      );
      const attempts: Login[] = [];
      const logged: string[] = [];
      const served = await withFallbackLogin(
        directory,
        (login) => {
          attempts.push(login);
          if (login.name === "first") throw new UsageLimitError("limited");
          return Promise.resolve(login.name);
        },
        (line) => logged.push(line),
        { CLAUDE_CODE_OAUTH_TOKEN: firstToken }
      );
      expect(served).toBe("fallback");
      expect(attempts.map(({ name, token }) => [name, token])).toEqual([
        ["first", firstToken],
        ["fallback", fallbackToken],
      ]);
      expect(attempts[1]?.variable).toBe("CLAUDE_CODE_OAUTH_TOKEN_FALLBACK");
      expect(attempts[0]?.secrets).toEqual([firstToken, fallbackToken]);
      expect(logged).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("does not switch logins for any other error", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "eval-login-"));
    try {
      let attempts = 0;
      await expect(
        withFallbackLogin(
          directory,
          () => {
            attempts += 1;
            return Promise.reject(new Error("The model is overloaded."));
          },
          () => undefined,
          {
            CLAUDE_CODE_OAUTH_TOKEN: firstToken,
            CLAUDE_CODE_OAUTH_TOKEN_FALLBACK: fallbackToken,
          }
        )
      ).rejects.toThrow("The model is overloaded.");
      expect(attempts).toBe(1);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

describe("the driver's limit flag", () => {
  const workDirs: string[] = [];
  afterAll(() =>
    Promise.all(workDirs.map((dir) => rm(dir, { recursive: true })))
  );

  async function drive(fixture: string) {
    const workDir = await mkdtemp(path.join(os.tmpdir(), "eval-login-"));
    workDirs.push(workDir);
    return runClaude({
      cwd: workDir,
      environment: {
        PATH: [
          path.join(fixturesDir, "bin"),
          path.dirname(process.execPath),
        ].join(path.delimiter),
        ...claudeEnvironment(
          {
            configDir: path.join(workDir, "claude-config"),
            oauthToken: firstToken,
          },
          {}
        ),
        FAKE_CLAUDE_TRANSCRIPT: path.join(fixturesDir, fixture),
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
  }

  it("is set by a limit in the setup turn, which ends the run before the task", async () => {
    const run = await drive("limit-in-setup.jsonl");
    expect(run.usageLimited).toBe(true);
    expect(run.task).toBeNull();
  });

  it("is set by a limit in the task turn, after a completed setup turn", async () => {
    const run = await drive("limit-in-task.jsonl");
    expect(run.usageLimited).toBe(true);
    expect(run.setupFailure).toBeNull();
    expect(run.task).not.toBeNull();
  });

  it("is not set by a completed run", async () => {
    expect((await drive("complete.jsonl")).usageLimited).toBe(false);
  });
});

/**
 * The startup lane is a real caller of the retry. The stand-in `claude`
 * answers by the OAuth token it receives, so a harness that sent the same
 * token twice would fail these.
 */
describe("runStartup across two logins", () => {
  const id = `login-test-${Math.random().toString(16).slice(2, 8)}`;
  const scenario = { ...startupScenarios[defaultScenarioId], id };
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    for (const name of await readdir(runsRoot))
      if (name.includes(`-startup-${id}-`))
        await rm(path.join(runsRoot, name), { recursive: true, force: true });
  });

  const fixture = (name: string) => path.join(fixturesDir, name);
  const runFolders = async () =>
    (await readdir(runsRoot)).filter((name) =>
      name.includes(`-startup-${id}-`)
    );

  function logins(fixtureOf: { first: string; fallback: string }) {
    vi.stubEnv(
      "PATH",
      [path.join(fixturesDir, "bin"), path.dirname(process.execPath)].join(
        path.delimiter
      )
    );
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", firstToken);
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN_FALLBACK", fallbackToken);
    vi.stubEnv(
      "FAKE_CLAUDE_BY_TOKEN",
      JSON.stringify({
        [firstToken]: fixture(fixtureOf.first),
        [fallbackToken]: fixture(fixtureOf.fallback),
      })
    );
  }

  const start = async () => {
    const { runDir, result } = await runStartup({
      scenario,
      model: "sonnet",
      timeoutMs: 10_000,
    });
    return { runDir, result: result as StartupResult };
  };

  it("repeats the run on the fallback login when the first is limited, and records the login by name", async () => {
    logins({ first: "limit-in-setup.jsonl", fallback: "startup-exact.jsonl" });
    const before = (await runFolders()).length;
    const { result, runDir } = await start();
    expect(result.login).toBe("fallback");
    expect(result.pass).toBe(true);
    expect(JSON.stringify(result)).not.toContain(fallbackToken);
    expect(JSON.stringify(result)).not.toContain(firstToken);
    // Both attempts leave their own folder; the discarded one keeps its transcript.
    const folders = await runFolders();
    expect(folders).toHaveLength(before + 2);
    const discarded = folders.find(
      (name) =>
        !runDir.endsWith(name) &&
        !existsSync(path.join(runsRoot, name, "result.json"))
    );
    expect(discarded).toBeDefined();
    expect(
      await readFile(
        path.join(runsRoot, discarded!, "transcript.jsonl"),
        "utf8"
      )
    ).toContain("You've hit your weekly limit");
  });

  it("uses the first login alone when it is not limited", async () => {
    logins({ first: "startup-exact.jsonl", fallback: "limit-in-setup.jsonl" });
    const before = (await runFolders()).length;
    const { result } = await start();
    expect(result.login).toBe("first");
    expect(await runFolders()).toHaveLength(before + 1);
  });

  it("stops with a message that says both logins are at their limit", async () => {
    logins({ first: "limit-in-setup.jsonl", fallback: "limit-in-setup.jsonl" });
    await expect(start()).rejects.toThrow(
      /^Both Claude Code logins are at their usage limit, so the run cannot complete\. The transcript is in /
    );
  });

  it("keeps neither token in any file of either attempt, although the agent echoes it on both streams", async () => {
    logins({ first: "limit-in-setup.jsonl", fallback: "startup-exact.jsonl" });
    vi.stubEnv("FAKE_CLAUDE_ECHO_TOKEN", "1");
    await start();
    const folders = (await runFolders()).slice(-2);
    expect(folders).toHaveLength(2);
    for (const folder of folders)
      for (const file of ["transcript.jsonl", "stderr.log"]) {
        const text = await readFile(path.join(runsRoot, folder, file), "utf8");
        expect(text, `${folder}/${file}`).toContain("[redacted]");
        for (const token of [firstToken, fallbackToken])
          expect(text, `${folder}/${file}`).not.toContain(token);
      }
  });

  it("names the second login's variable when Claude Code does not accept its token", async () => {
    logins({ first: "limit-in-setup.jsonl", fallback: "startup-exact.jsonl" });
    vi.stubEnv(
      "FAKE_CLAUDE_BY_TOKEN",
      JSON.stringify({ [firstToken]: fixture("limit-in-setup.jsonl") })
    );
    const error = await start().catch((thrown: unknown) => thrown as Error);
    expect((error as Error).message).toContain(
      "Claude Code does not accept the CLAUDE_CODE_OAUTH_TOKEN_FALLBACK"
    );
    expect((error as Error).message).not.toContain(
      "accept the CLAUDE_CODE_OAUTH_TOKEN from"
    );
  });
});
