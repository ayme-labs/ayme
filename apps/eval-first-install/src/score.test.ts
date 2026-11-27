import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scoreRun, table } from "./score.ts";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

type Phase = "setup" | "task";
/** A worker's tool call and its result, as Claude Code's stream-json writes them. */
type Use = { name: string; input: object; result?: string };
/** One `ayme` command as the recorder writes it: its start, and its end
 * unless it never ended. */
type Command = {
  phase: Phase;
  args: string[];
  code?: number;
  stdout?: string;
  stderr?: string;
};

/** A run's folder holding the files a run leaves. */
function runFolder(run: {
  setup?: Use[];
  task?: Use[];
  commands?: Command[];
  packageJson?: object;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-first-install-score-"));
  folders.push(dir);
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({ runId: "playwright-cli-1", tool: "playwright-cli" })
  );
  for (const phase of ["setup", "task"] as const) {
    const events = (run[phase] ?? []).flatMap((use, at) => [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: `${phase}${at}`,
              ...use,
              result: undefined,
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: `${phase}${at}`,
              content: use.result ?? "",
            },
          ],
        },
      },
    ]);
    writeFileSync(
      join(dir, `${phase}.jsonl`),
      events.map((event) => `${JSON.stringify(event)}\n`).join("")
    );
  }
  if (run.commands) {
    const lines = run.commands.flatMap((command, pid) => [
      {
        t: "2026-11-27T10:00:00.000Z",
        pid,
        event: "start",
        phase: command.phase,
        args: command.args,
        cwd: "/project",
      },
      ...(command.code === undefined
        ? []
        : [
            {
              t: "2026-11-27T10:00:01.000Z",
              pid,
              event: "end",
              code: command.code,
              stdout: command.stdout ?? "",
              stderr: command.stderr ?? "",
            },
          ]),
    ]);
    writeFileSync(
      join(dir, "ayme-record.jsonl"),
      lines.map((line) => `${JSON.stringify(line)}\n`).join("")
    );
  }
  if (run.packageJson) {
    mkdirSync(join(dir, "configs"));
    writeFileSync(
      join(dir, "configs", "package.json"),
      JSON.stringify(run.packageJson)
    );
  }
  return dir;
}

const call = (tool: string, phase: Phase = "task", code: number = 0) => ({
  phase,
  args: ["call", tool, "--params", "{}"],
  code,
});

describe("the ayme commands", () => {
  it("count the task's Page Object Tools called with ayme call in the task phase, and those that failed or never answered", () => {
    const score = scoreRun(
      runFolder({
        commands: [
          call("ListPage.addItem", "setup"),
          { phase: "task", args: ["open", "http://127.0.0.1:4000/"], code: 0 },
          { phase: "task", args: ["page-objects"], code: 0 },
          call("ListPage.addItem"),
          call("ListItem.rename", "task", 1),
          { phase: "task", args: ["call", "ListItem.archive"] },
        ],
      })
    );

    expect(score).toMatchObject({ channel: "ayme", poCalls: 3, poErrors: 2 });
  });

  it("are read past the global options, as the command reads them", () => {
    const score = scoreRun(
      runFolder({
        commands: [
          {
            phase: "task",
            args: [
              "-s",
              "call",
              "--json",
              "call",
              "--tab=http://127.0.0.1:4000/",
              "ListItem.rename",
              "--params",
              '{"id": "po3", "args": {"text": "Soy milk"}}',
            ],
            code: 0,
          },
          {
            phase: "task",
            args: ["-s=w", "call", "--params", "{}", "ArchiveDialog.confirm"],
            code: 0,
          },
        ],
      })
    );

    expect(score).toMatchObject({ poCalls: 2, poErrors: 0 });
    expect(score.aymeCommands).toEqual({
      setup: {},
      task: { call: { count: 2, failed: 0 } },
    });
  });

  it("are summed up per phase in the table, with how many failed", () => {
    const score = scoreRun(
      runFolder({
        commands: [
          { phase: "setup", args: ["--help"], code: 0 },
          { phase: "setup", args: ["open", "http://127.0.0.1:4000/"], code: 1 },
          { phase: "task", args: ["open", "http://127.0.0.1:4000/"], code: 0 },
          { phase: "task", args: ["page-objects"], code: 0 },
          { phase: "task", args: ["page-objects"], code: 0 },
          call("ListPage.addItem", "task", 1),
          call("ListPage.addItem"),
          { phase: "task", args: ["close"], code: 0 },
        ],
      })
    );

    expect(table([score])).toContain(
      "| setup: --help 1, open 1 (1 failed); task: open 1, page-objects 2, call 2 (1 failed), close 1 |"
    );
  });

  it("are n/a for a run without a recording", () => {
    const score = scoreRun(runFolder({}));

    expect(score).toMatchObject({ aymeCommands: null, channel: "none" });
    expect(table([score])).toContain("| none | 0 (0) | n/a |");
  });
});

describe("the channel", () => {
  it("is webmcp for a page's WebMCP tool called through the browser automation, and both beside ayme call", () => {
    const webmcp = {
      name: "Bash",
      input: {
        command:
          'playwright-cli webmcp-call ListPage.addItem \'{"text": "Oat milk"}\'',
      },
    };

    expect(scoreRun(runFolder({ task: [webmcp] }))).toMatchObject({
      channel: "webmcp",
      poCalls: 1,
    });
    expect(
      scoreRun(
        runFolder({ task: [webmcp], commands: [call("ListItem.archive")] })
      )
    ).toMatchObject({ channel: "both", poCalls: 2 });
  });
});

describe("the browser downloads", () => {
  it("count a browser install, but neither Playwright CLI's workspace init nor a command quoted in a heredoc", () => {
    const score = scoreRun(
      runFolder({
        setup: [
          {
            name: "Bash",
            input: { command: "npx playwright-cli install --skills" },
            // Run where Chrome is installed, it fetches FFMPEG, no browser.
            result:
              "Downloading FFMPEG playwright build v1011\n✅ Found chrome",
          },
          {
            name: "Bash",
            input: {
              command:
                "cat > REPORT.md <<'EOF'\n- `npx playwright install chromium`\n- agent-browser install\nEOF\necho done",
            },
          },
        ],
        task: [
          {
            name: "Bash",
            input: { command: "npx playwright install chromium" },
            result:
              "Downloading Chromium 141.0.7390.37 (playwright build v1194)",
          },
        ],
      })
    );

    expect(score.downloads).toEqual(["task: playwright install chromium"]);
  });
});

describe("the ayme packages", () => {
  it("are the project's @ayme-dev packages as the run left them, each with its section", () => {
    const score = scoreRun(
      runFolder({
        packageJson: {
          dependencies: { react: "^19.0.0" },
          devDependencies: {
            "@ayme-dev/ayme": "0.3.0-first-install.gabc",
            "@ayme-dev/cli": "^0.3.0-first-install.gabc",
            "@playwright/test": "1.64.1",
          },
        },
      })
    );

    expect(score.aymePackages).toEqual([
      "@ayme-dev/ayme@0.3.0-first-install.gabc (dev)",
      "@ayme-dev/cli@^0.3.0-first-install.gabc (dev)",
    ]);
  });
});
