import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { approveMcpJson } from "./paths.ts";

let project: string;
let log: string;
beforeEach(() => {
  project = realpathSync(
    mkdtempSync(join(tmpdir(), "eval-first-install-approve-"))
  );
  log = join(project, "approvals.log");
});
afterEach(() => rmSync(project, { recursive: true, force: true }));

/** What the hook prints when Claude Code asks about `tool_input` of
 * `tool_name`, in the worker's project. */
function ask(tool_name: string, tool_input: object): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [approveMcpJson, log],
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    );
    child.stdin!.end(
      JSON.stringify({
        hook_event_name: "PermissionRequest",
        cwd: project,
        tool_name,
        tool_input,
      })
    );
  });
}

const allowed = {
  hookSpecificOutput: {
    hookEventName: "PermissionRequest",
    decision: { behavior: "allow" },
  },
};

it("approves a Write or Edit of the project's .mcp.json, and logs it", async () => {
  expect(
    JSON.parse(await ask("Write", { file_path: join(project, ".mcp.json") }))
  ).toEqual(allowed);
  expect(JSON.parse(await ask("Edit", { file_path: ".mcp.json" }))).toEqual(
    allowed
  );
  expect(readFileSync(log, "utf8")).toBe(
    `Write ${join(project, ".mcp.json")}\nEdit .mcp.json\n`
  );
});

it("approves a Bash command that edits the project's .mcp.json, as Claude Code asks about it too, and logs it", async () => {
  const command =
    'sed -i \'s|"--no"|"--no", "--"|\' .mcp.json && node -e \'JSON.parse(require("fs").readFileSync(".mcp.json"))\'';

  expect(JSON.parse(await ask("Bash", { command }))).toEqual(allowed);
  expect(readFileSync(log, "utf8")).toBe(`Bash ${command}\n`);
});

it("leaves every other question unanswered", async () => {
  expect(
    await ask("Write", { file_path: join(project, "playwright-mcp.json") })
  ).toBe("");
  expect(
    await ask("Edit", { file_path: join(tmpdir(), "elsewhere", ".mcp.json") })
  ).toBe("");
  expect(await ask("Bash", { command: "rm -rf node_modules" })).toBe("");
  expect(await ask("Bash", { command: "cat ../other/.mcp.json" })).toBe("");
  expect(existsSync(log)).toBe(false);
});
