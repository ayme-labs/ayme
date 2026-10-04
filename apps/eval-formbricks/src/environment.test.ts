import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  envFileName,
  parseEnvFile,
  readOauthToken,
  tokenVariable,
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
