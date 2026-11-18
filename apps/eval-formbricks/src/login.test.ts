import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  readLoginTokens,
  UsageLimitError,
  withFallbackLogin,
  type Login,
} from "./login.ts";
import { runsRoot } from "./paths.ts";
import { tearDown } from "./run.ts";
import { defaultScenarioId, startupScenarios } from "./scenarios.ts";
import { runStartup, type StartupResult } from "./startup.ts";
import { isUsageLimitText } from "./transcript.ts";

// Dummy values with the shape of a Claude Code token.
const firstToken = "sk-ant-oat01-dummyFirstTokenForTests9f3a0000";
const fallbackToken = "sk-ant-oat01-dummyFallbackTokenForTests77c10000";
/** The token with every character as a JSON escape, as a careless agent might print it. */
const jsonEscaped = (token: string) =>
  [...token]
    .map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .join("");
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
      "Credit balance is too low",
      "Your org is out of usage · add funds to continue",
      "Your org is out of usage · contact your admin",
      "Your seat type doesn't include usage credits",
      "Your usage allocation has been disabled by your admin",
      "Your group's usage limit is set to $0",
      "This service is disabled for your org",
      "Fable 5 requires usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage?from=cc_cli_limit_message, to continue.",
      "Fable 5 requires usage credits. /model to switch models.",
      "Sonnet 5.5 requires usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage, to continue.",
      "Haiku 5.5 requires usage credits. /model to switch models.",
      "You've hit your team's pooled group budget · an org owner or channel manager can raise it in the channel's Claude settings",
      "API Error: Usage credits required for 1M context · run /usage-credits to turn them on (they take effect in a new session), or /model sonnet to switch to standard context",
    ])
      expect(isUsageLimitText(text), text).toBe(true);
  });

  it("leaves overload, other errors and quoted texts alone", () => {
    for (const text of [
      "API Error: 529 overloaded",
      "Server is temporarily limiting requests (not your usage limit)",
      "Opus is experiencing high load, please use /model to switch to Sonnet",
      "Fable is experiencing high load, please use /model to switch to Sonnet",
      "Fable is experiencing high load. Switch to Sonnet.",
      "API Error: Request rejected (429) · this may be a temporary capacity issue.",
      "Done. You've hit your target.",
      "I told you: You've hit your weekly limit",
      "I told you: Fable 5 requires usage credits.",
      "I told you: Haiku 5.5 requires usage credits.",
      "Fast mode requires usage credits. Run /usage-credits to continue.",
      "I told you: Credit balance is too low",
      "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access",
      "Your account is on hold and can't sign in to Claude Code. View details or appeal: https://claude.ai/appeal",
      "Opus with 1M context is not available for your account.",
    ])
      expect(isUsageLimitText(text), text).toBe(false);
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

  it("refuses a token that does not have the shape of a Claude Code token, naming the variable and never the value", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "eval-login-"));
    try {
      const attempt = () => Promise.resolve();
      const refuse = (environment: NodeJS.ProcessEnv) =>
        withFallbackLogin(directory, attempt, () => undefined, environment);
      const short = await refuse({
        CLAUDE_CODE_OAUTH_TOKEN: firstToken,
        CLAUDE_CODE_OAUTH_TOKEN_FALLBACK: "e",
      }).catch((error: unknown) => (error as Error).message);
      expect(short).toContain("CLAUDE_CODE_OAUTH_TOKEN_FALLBACK");
      expect(short).not.toContain('"e"');
      const first = await refuse({
        CLAUDE_CODE_OAUTH_TOKEN: "not-a-token-0123456789",
      }).catch((error: unknown) => (error as Error).message);
      expect(first).toContain("CLAUDE_CODE_OAUTH_TOKEN ");
      expect(first).not.toContain("not-a-token");
      // The suite's preflight reads the tokens the same way, so it refuses them the same way.
      expect(() =>
        readLoginTokens(directory, {
          CLAUDE_CODE_OAUTH_TOKEN: "not-a-token-0123456789",
          CLAUDE_CODE_OAUTH_TOKEN_FALLBACK: fallbackToken,
        })
      ).toThrow(/^CLAUDE_CODE_OAUTH_TOKEN does not have the shape/);
      expect(() =>
        readLoginTokens(directory, {
          CLAUDE_CODE_OAUTH_TOKEN: firstToken,
          CLAUDE_CODE_OAUTH_TOKEN_FALLBACK: "e",
        })
      ).toThrow(/^CLAUDE_CODE_OAUTH_TOKEN_FALLBACK does not have the shape/);
      // An empty fallback is no second token.
      await expect(
        refuse({
          CLAUDE_CODE_OAUTH_TOKEN: firstToken,
          CLAUDE_CODE_OAUTH_TOKEN_FALLBACK: "",
        })
      ).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

describe("tearDown", () => {
  const failing = () => Promise.reject(new Error("connection lost"));

  it("logs a step that fails and keeps the error that is already being reported", async () => {
    const written: string[] = [];
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => {
        written.push(String(chunk));
        return true;
      });
    try {
      await expect(
        tearDown("close the database", failing, true)
      ).resolves.toBeUndefined();
    } finally {
      write.mockRestore();
    }
    expect(written.join("")).toContain(
      "Could not close the database: connection lost"
    );
  });

  it("lets a step that fails surface when the run itself succeeded", async () => {
    await expect(
      tearDown("close the database", failing, false)
    ).rejects.toThrow("connection lost");
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
    for (const name of await runFolders())
      await rm(path.join(runsRoot, name), { recursive: true, force: true });
  });

  const fixture = (name: string) => path.join(fixturesDir, name);
  // The runs folder does not exist before the first run has created it.
  async function runFolders() {
    const names = await readdir(runsRoot).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return [] as string[];
      throw error;
    });
    return names.filter((name) => name.includes(`-startup-${id}-`));
  }

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

  it("repeats the run on the fallback login when the first is limited, records the login by name and keeps neither token in either attempt's files", async () => {
    logins({ first: "limit-in-setup.jsonl", fallback: "startup-exact.jsonl" });
    // The agent echoes its token on both streams, once in JSON escapes, once in indented JSON over several lines.
    vi.stubEnv("FAKE_CLAUDE_ECHO_TOKEN", "1");
    const known = new Set(await runFolders());
    const { result, runDir } = await start();
    expect(result.login).toBe("fallback");
    expect(result.pass).toBe(true);
    expect(JSON.stringify(result)).not.toContain(fallbackToken);
    expect(JSON.stringify(result)).not.toContain(firstToken);
    // Both attempts leave their own folder; the discarded one keeps its transcript.
    const created = (await runFolders()).filter((name) => !known.has(name));
    expect(created).toHaveLength(2);
    const discarded = created.find((name) => !runDir.endsWith(name));
    expect(discarded).toBeDefined();
    expect(existsSync(path.join(runsRoot, discarded!, "result.json"))).toBe(
      false
    );
    expect(
      await readFile(
        path.join(runsRoot, discarded!, "transcript.jsonl"),
        "utf8"
      )
    ).toContain("You've hit your weekly limit");
    for (const folder of created)
      for (const file of ["transcript.jsonl", "stderr.log"]) {
        const text = await readFile(path.join(runsRoot, folder, file), "utf8");
        expect(text, `${folder}/${file}`).toContain("[redacted]");
        for (const token of [firstToken, fallbackToken]) {
          expect(text, `${folder}/${file}`).not.toContain(token);
          expect(text, `${folder}/${file}`).not.toContain(jsonEscaped(token));
        }
      }
  });

  it("uses the first login alone when it is not limited", async () => {
    logins({ first: "startup-exact.jsonl", fallback: "limit-in-setup.jsonl" });
    const before = (await runFolders()).length;
    const { result } = await start();
    expect(result.login).toBe("first");
    expect(await runFolders()).toHaveLength(before + 1);
  });

  it("does not switch logins for an error that is not a usage limit", async () => {
    // "API Error: 529 overloaded"
    logins({ first: "setup-failed.jsonl", fallback: "startup-exact.jsonl" });
    const before = (await runFolders()).length;
    await expect(start()).rejects.toThrow(/the setup turn ended with an error/);
    expect(await runFolders()).toHaveLength(before + 1);
  });

  it("stops with a message that says both logins are at their limit", async () => {
    logins({ first: "limit-in-setup.jsonl", fallback: "limit-in-setup.jsonl" });
    await expect(start()).rejects.toThrow(
      /^Both Claude Code logins are at their usage limit, so the run cannot complete\. The transcript is in /
    );
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
