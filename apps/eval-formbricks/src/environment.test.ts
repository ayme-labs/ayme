import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  codexTokenVariable,
  envFileName,
  fallbackTokenVariable,
  parseEnvFile,
  readEnvVariable,
  readOauthToken,
  tokenVariable,
  withholdTokens,
} from "./environment.ts";

describe("parseEnvFile", () => {
  it("reads plain, quoted and exported assignments and skips comments", () => {
    expect(
      parseEnvFile(
        [
          "# the token",
          `${tokenVariable}=token-value`,
          'QUOTED="with spaces" ',
          "export EXPORTED='single'",
          "TRAILING=value # comment",
          "not an assignment",
          "",
        ].join("\n")
      )
    ).toEqual({
      [tokenVariable]: "token-value",
      QUOTED: "with spaces",
      EXPORTED: "single",
      TRAILING: "value",
    });
  });
});

describe("readOauthToken", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "eval-env-"));
  afterEach(() => rmSync(path.join(directory, envFileName), { force: true }));

  it("is undefined without a file or an exported variable", () => {
    expect(readOauthToken(directory, {})).toBeUndefined();
  });

  it("reads the token from the env file", () => {
    writeFileSync(
      path.join(directory, envFileName),
      `${tokenVariable}=from-file\n`
    );
    expect(readOauthToken(directory, {})).toBe("from-file");
  });

  it("lets an exported variable win over the file", () => {
    writeFileSync(
      path.join(directory, envFileName),
      `${tokenVariable}=from-file\n`
    );
    expect(readOauthToken(directory, { [tokenVariable]: "from-shell" })).toBe(
      "from-shell"
    );
  });

  it("treats an empty value as missing", () => {
    writeFileSync(path.join(directory, envFileName), `${tokenVariable}=\n`);
    expect(readOauthToken(directory, { [tokenVariable]: "" })).toBeUndefined();
  });
});

describe("withholdTokens", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    withholdTokens({});
  });

  it("keeps the exported tokens from child processes, and the eval still reads them", () => {
    const variables = [
      tokenVariable,
      fallbackTokenVariable,
      codexTokenVariable,
    ];
    for (const name of variables) vi.stubEnv(name, `${name}-value`);
    withholdTokens();

    // A child started as Docker, git or Chrome is: with no environment of its own.
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `process.stdout.write(JSON.stringify(${JSON.stringify(variables)}.filter((name) => name in process.env)))`,
      ],
      { encoding: "utf8" }
    );
    expect(JSON.parse(child.stdout)).toEqual([]);

    const directory = mkdtempSync(path.join(os.tmpdir(), "eval-env-"));
    for (const name of variables)
      expect(readEnvVariable(name, directory)).toBe(`${name}-value`);
    rmSync(directory, { recursive: true });
  });
});
