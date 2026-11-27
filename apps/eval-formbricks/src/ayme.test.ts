import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";

import {
  aymeCacheDirectory,
  aymeRecordPath,
  aymeShimScript,
  aymeSkillDirectory,
  aymeSkillSource,
  listedToolNames,
  openedAddress,
} from "./ayme.ts";
import { evalRoot, labRoot, repoRoot } from "./paths.ts";

const execFileAsync = promisify(execFile);

describe("the ayme arms' skill", () => {
  it("is the one the repository ships, under skills/", () => {
    const skills = path.join(repoRoot, "skills");
    expect(aymeSkillSource.startsWith(`${skills}${path.sep}`)).toBe(true);
    expect(existsSync(path.join(aymeSkillSource, "SKILL.md"))).toBe(true);
    expect(
      existsSync(path.join(aymeSkillSource, "references/page-tools.md"))
    ).toBe(true);
  });

  it("has no copy in this package", () => {
    expect(existsSync(path.join(evalRoot, "skills"))).toBe(false);
  });

  it("is copied into the run's configuration folder, where Claude Code loads user skills from", () => {
    expect(aymeSkillDirectory("/run/claude-config")).toBe(
      "/run/claude-config/skills/ayme"
    );
  });
});

/**
 * The `ayme` executable on the agent's PATH, run over a stand-in for the
 * built command that prints where it ran and what it was given.
 */
describe("the agent's ayme command", () => {
  const folders: string[] = [];
  afterAll(() =>
    Promise.all(folders.map((folder) => rm(folder, { recursive: true })))
  );

  async function shim(standIn: string) {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "ayme-eval-shim-"));
    folders.push(runDir);
    const commandPath = path.join(runDir, "cli.mjs");
    await writeFile(commandPath, standIn);
    const shimPath = path.join(runDir, "ayme");
    await writeFile(shimPath, aymeShimScript({ runDir, commandPath }));
    await chmod(shimPath, 0o755);
    const run = (args: string[]) =>
      execFileAsync(shimPath, args, { cwd: os.tmpdir() }).then(
        ({ stdout }) => ({ code: 0, stdout }),
        (error: { code: number; stdout: string }) => ({
          code: error.code,
          stdout: error.stdout,
        })
      );
    const recorded = () =>
      readFileSync(aymeRecordPath(runDir), "utf8")
        .trim()
        .split("\n")
        .map(
          (line) => JSON.parse(line) as Record<string, unknown> & { t: string }
        );
    return { runDir, run, recorded };
  }

  const printsWhereItRan = `process.stdout.write(JSON.stringify({ cwd: process.cwd(), cache: process.env.AYME_CACHE_DIR, args: process.argv.slice(2) }));
process.exitCode = process.argv[2] === "fail" ? 1 : 0;`;

  it("runs in the lab app's folder, the Session's project, with the run's cache folder, wherever the agent runs it", async () => {
    const { runDir, run } = await shim(printsWhereItRan);

    const { code, stdout } = await run(["page-objects"]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      cwd: labRoot,
      cache: aymeCacheDirectory(runDir),
      args: ["page-objects"],
    });
  });

  it("records each command with its arguments, its exit code and what it printed", async () => {
    const { run, recorded } = await shim(printsWhereItRan);

    await run(["call", "SignInPage.logIn", "--params", "{}"]);
    await run(["fail"]);

    expect(recorded()).toEqual([
      {
        t: expect.any(String),
        pid: expect.any(Number),
        event: "start",
        args: ["call", "SignInPage.logIn", "--params", "{}"],
      },
      {
        t: expect.any(String),
        pid: expect.any(Number),
        event: "end",
        code: 0,
        stdout: expect.stringContaining('"SignInPage.logIn"'),
        stderr: "",
      },
      expect.objectContaining({ event: "start", args: ["fail"] }),
      expect.objectContaining({ event: "end", code: 1 }),
    ]);
  });

  it("does not record the Session's background process, which no agent runs", async () => {
    const { run, recorded } = await shim(`process.stdout.write("ok");`);

    await run(["__session", "{}"]);
    await run(["tools"]);

    expect(recorded().map((line) => line.args ?? line.event)).toEqual([
      ["tools"],
      "end",
    ]);
  });
});

describe("what the harness reads of the command", () => {
  it("takes the browser's address from ayme open --json", () => {
    expect(
      openedAddress(
        '{"ok":true,"text":"A Session started.","data":{"address":"http://127.0.0.1:49370"}}'
      )
    ).toBe("http://127.0.0.1:49370");
    expect(() => openedAddress('{"ok":true,"text":"x"}')).toThrow(
      "ayme open printed no address"
    );
  });

  it("takes the Page Object Tools from ayme tools, an unavailable one too", () => {
    expect(
      listedToolNames(
        [
          "Tab: Edit survey (http://localhost:3000/edit)",
          "SurveyEditorPage.fillSurveyForm: Replaces the survey's name.",
          '  parameters: {"type":"object"}',
          "SurveyEditorPage.save (unavailable: The survey is a draft.): Saves it.",
          "",
        ].join("\n")
      )
    ).toEqual(["SurveyEditorPage.fillSurveyForm", "SurveyEditorPage.save"]);
  });
});
