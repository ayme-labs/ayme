import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { usageLimitError, withFallbackLogin } from "./login.ts";
import { runsRoot } from "./paths.ts";
import { defaultScenarioId, startupScenarios } from "./scenarios.ts";
import { runStartup, type StartupResult } from "./startup.ts";
import { resultEvent } from "./transcript.ts";

const firstToken = "first-token-for-the-test";
const fallbackToken = "fallback-token-for-the-test";
const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

describe("a result event's usage limit", () => {
  const usageLimit = (result: string, isError = true) =>
    resultEvent(JSON.stringify({ type: "result", is_error: isError, result }))
      ?.usageLimit;

  it("matches each text Claude Code gives for an exhausted login", () => {
    for (const text of [
      "You've hit your weekly limit · resets Nov 20, 9am (UTC)",
      "You've hit your team's shared budget. /model to switch models.",
      "You've reached your Fable limit.",
      "You're out of usage credits · resets Nov 20 · progress saved",
      "You're out of extra usage",
      "Credit balance is too low",
      "Your org is out of usage · add funds to continue",
      "Your seat type doesn't include usage credits",
      "Your usage allocation has been disabled by your admin",
      "Your group's usage limit is set to $0",
      "This service is disabled for your org",
      "Sonnet 5.5 requires usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage, to continue.",
      "API Error: Usage credits required for 1M context · run /usage-credits to turn them on (they take effect in a new session), or /model sonnet to switch to standard context",
    ])
      expect(usageLimit(text), text).toBe(true);
  });

  it("leaves overload, other errors and quoted texts alone", () => {
    for (const text of [
      "API Error: 529 overloaded",
      "Server is temporarily limiting requests (not your usage limit)",
      "Opus is experiencing high load, please use /model to switch to Sonnet",
      "I told you: You've hit your weekly limit",
      "Fast mode requires usage credits. Run /usage-credits to continue.",
      "Your account is on hold and can't sign in to Claude Code. View details or appeal: https://claude.ai/appeal",
    ])
      expect(usageLimit(text), text).toBe(false);
    // The same text in a result that is not an error is the model's, not the CLI's.
    expect(usageLimit("You've hit your weekly limit", false)).toBe(false);
  });
});

describe("withFallbackLogin without a second token", () => {
  const exported = { CLAUDE_CODE_OAUTH_TOKEN: firstToken };
  let directory: string;
  afterEach(() => rm(directory, { recursive: true }));

  it("lets a limited run stand, as before there was a second login", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "eval-login-"));
    const outcome = await withFallbackLogin(
      directory,
      (login) =>
        Promise.resolve(usageLimitError({ usageLimited: true }, login, "x")),
      () => undefined,
      exported
    );
    expect(outcome).toBeNull();
  });

  it("does not look for one before the first login is limited", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "eval-login-"));
    // An env file that cannot be read: a folder in its place.
    await mkdir(path.join(directory, ".env.local"));
    await expect(
      withFallbackLogin(
        directory,
        () => Promise.resolve("served"),
        () => undefined,
        exported
      )
    ).resolves.toBe("served");
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

  it("repeats the run on the fallback login when the first is limited and records the login by name", async () => {
    logins({ first: "limit-in-setup.jsonl", fallback: "startup-exact.jsonl" });
    const known = new Set(await runFolders());
    const { result, runDir } = await start();
    expect(result.login).toBe("fallback");
    expect(result.pass).toBe(true);
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
