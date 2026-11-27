/**
 * Scores a run from its files alone: the two stream-json transcripts, the
 * harness's outcome check, the worker's REPORT.md and package.json, and the
 * recording of its `ayme` commands.
 *
 *   node src/score.ts <run dir>... [--json <file>]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
} from "node:path";
import { parseArgs } from "node:util";

/** How a Page Object action was called: `ayme call`, which the skill names
 * for every browser automation, or a page's WebMCP tool, should a worker
 * find that way. */
type Channel = "ayme" | "webmcp";

type Phase = "setup" | "task";

/** Of one `ayme` command in one phase: how often it ran, and how often it
 * exited with an error or never answered. */
type CommandCount = { count: number; failed: number };

export type Score = {
  run: string;
  tool: string;
  outcome: "pass" | "fail" | "n/a" | "harness error";
  claimed: string;
  skill: string;
  docs: string[];
  /** The project's `@ayme-dev/*` packages as the run left them; null
   * without the run's copy of its package.json. */
  aymePackages: string[] | null;
  channel: string;
  poCalls: number;
  poErrors: number;
  /** Each phase's `ayme` commands, by the command's name; null without a
   * recording. */
  aymeCommands: Record<Phase, Record<string, CommandCount>> | null;
  plainActions: number;
  plainActionList: string[];
  restartAskedInTask: boolean;
  downloads: string[];
  turns: number;
  seconds: number;
  costUsd: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Claude Code's stream-json events have no published types.
type Event = Record<string, any>;
type ToolUse = {
  phase: Phase;
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
};

function readJsonl(file: string): Event[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Event];
      } catch {
        return [];
      }
    });
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((c) => (typeof c?.text === "string" ? c.text : ""))
      .join("\n");
  return "";
}

function toolUses(events: Event[], phase: Phase): ToolUse[] {
  const uses: ToolUse[] = [];
  const byId = new Map<string, ToolUse>();
  for (const event of events) {
    for (const part of event.message?.content ?? []) {
      if (event.type === "assistant" && part.type === "tool_use") {
        const use = {
          phase,
          name: part.name,
          input: part.input ?? {},
          result: "",
          isError: false,
        };
        uses.push(use);
        byId.set(part.id, use);
      }
      if (event.type === "user" && part.type === "tool_result") {
        const use = byId.get(part.tool_use_id);
        if (use) {
          use.result = resultText(part.content);
          use.isError = part.is_error === true;
        }
      }
    }
  }
  return uses;
}

function assistantTexts(events: Event[]): string[] {
  return events.flatMap((event) =>
    event.type === "assistant"
      ? (event.message?.content ?? [])
          .filter((p: Event) => p.type === "text")
          .map((p: Event) => p.text as string)
      : []
  );
}

/** A Bash command split into simple commands, with `X=...tool...` variables
 * resolved and the bodies of heredocs left out: they are text, such as a
 * REPORT.md that quotes the commands it ran. */
function segments(command: string): { cwd: string; tokens: string[] }[] {
  let text = command.replace(
    /(<<-?\s*(["']?)(\w+)\2[^\n]*)\n[\s\S]*?\n\s*\3[ \t]*(?=\n|$)/g,
    "$1"
  );
  for (const match of text.matchAll(
    /(?:^|[\s;&(])([A-Za-z_]\w*)=("[^"]*"|'[^']*'|\S+)/g
  )) {
    const value = match[2]!.replace(/^["']|["']$/g, "");
    if (/playwright-cli|agent-browser/.test(value)) {
      const tool = value.includes("agent-browser")
        ? "agent-browser"
        : "playwright-cli";
      text = text.replace(
        new RegExp(`\\$\\{?${match[1]}\\}?(?!\\w)`, "g"),
        tool
      );
    }
  }
  let cwd = "";
  const result: { cwd: string; tokens: string[] }[] = [];
  for (const raw of text.split(/&&|\|\||[;|\n]/)) {
    const tokens =
      raw
        .trim()
        .replace(/^\(+|\)+$/g, "")
        .match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    if (tokens[0] === "cd" && tokens[1]) {
      const target = tokens[1].replace(/^["']|["']$/g, "");
      cwd = isAbsolute(target) ? target : normalize(join(cwd, target));
      continue;
    }
    result.push({
      cwd,
      tokens: tokens.map((t) => t.replace(/^["']|["']$/g, "")),
    });
  }
  return result;
}

const READERS = new Set([
  "cat",
  "head",
  "tail",
  "sed",
  "less",
  "more",
  "awk",
  "nl",
  "bat",
]);

function docName(path: string): string | undefined {
  const skill = /\.claude\/skills\/ayme\/(.+\.md)$/.exec(path);
  if (skill)
    return skill[1] === "SKILL.md" ? "skill" : basename(skill[1]!, ".md");
  const guide = /ayme-docs\/(.+)\.md$/.exec(path);
  if (guide) return `docs/${guide[1]}`;
  return undefined;
}

function docsRead(uses: ToolUse[]): string[] {
  const docs: string[] = [];
  const add = (name?: string) => {
    if (name && !docs.includes(name)) docs.push(name);
  };
  for (const use of uses) {
    if (use.name === "Skill" && /ayme/.test(String(use.input.skill ?? "")))
      add("skill");
    if (use.name === "Read") add(docName(String(use.input.file_path ?? "")));
    if (use.name === "Bash") {
      for (const { cwd, tokens } of segments(String(use.input.command ?? ""))) {
        if (!READERS.has(basename(tokens[0] ?? ""))) continue;
        for (const token of tokens.slice(1)) {
          if (!token.endsWith(".md")) continue;
          add(docName(isAbsolute(token) ? token : join(cwd || ".", token)));
        }
      }
    }
  }
  return docs;
}

const ACTION = /^(ListPage|ListItem|ArchiveDialog)[._](?!page_objects)\w+$/;
const PLAIN_VERBS = new Set([
  "click",
  "dblclick",
  "fill",
  "type",
  "press",
  "check",
  "uncheck",
  "select",
  "hover",
  "drag",
  "keydown",
  "keyup",
  "keyboard",
]);
// Options whose value can be a plain word, such as `--session first`, which
// would otherwise read as the command.
const VALUE_OPTIONS = new Set(["--session", "-s", "--profile", "--browser"]);
const PLAIN_MCP =
  /^browser_(click|type|fill_form|press_key|select_option|hover|drag)$/;

type Classified = {
  webmcp?: string;
  plain?: string;
  download?: string;
};

/** What one tool call did: a page's WebMCP tool called through the browser
 * automation, a plain browser action, or a browser download. The `ayme`
 * commands are read from their recording instead. */
function classify(use: ToolUse): Classified[] {
  const found: Classified[] = [];
  const mcp = /^mcp__(.+?)__(.+)$/.exec(use.name);
  if (mcp) {
    const tool = mcp[2]!;
    if (tool.startsWith("webmcp_")) {
      const name = tool.slice("webmcp_".length);
      if (ACTION.test(name)) found.push({ webmcp: name });
    } else if (PLAIN_MCP.test(tool)) {
      found.push({ plain: tool });
    } else if (tool === "browser_install") {
      found.push({ download: "browser_install" });
    }
    return found;
  }
  if (use.name !== "Bash") return found;
  for (const { tokens } of segments(String(use.input.command ?? ""))) {
    // `playwright-cli install` sets up a workspace, and its skills with
    // --skills: no browser of its own; `install-browser` is the browser.
    const install = tokens.findIndex(
      (t, i) =>
        t === "install-browser" ||
        (t === "install" &&
          /^(playwright|agent-browser)(@\S*)?$|^cli\.js$/.test(
            basename(tokens[i - 1] ?? "")
          ))
    );
    // `install --help` only reads the command's help.
    if (install >= 0 && !tokens.some((t) => t === "--help" || t === "-h")) {
      found.push({
        download: tokens
          .slice(Math.max(0, install - 1), install + 2)
          .map((t) => basename(t))
          .join(" "),
      });
      continue;
    }
    const at = tokens.findIndex((t) =>
      /(^|\/)(playwright-cli|agent-browser)(@[^/]+)?$/.test(t)
    );
    if (at < 0) continue;
    const rest = tokens.slice(at + 1);
    const verbAt = rest.findIndex(
      (t, i) =>
        !t.startsWith("-") &&
        !VALUE_OPTIONS.has(rest[i - 1] ?? "") &&
        /^[a-z][a-z-]*$/.test(t) &&
        t !== "true" &&
        t !== "false"
    );
    const verb = rest[verbAt] ?? "";
    const tool = basename(tokens[at]!);
    if (
      verb === "webmcp-call" ||
      (verb === "webmcp" && rest[verbAt + 1] === "invoke")
    ) {
      const name = rest.slice(verbAt + 1).find((t) => ACTION.test(t));
      if (name) found.push({ webmcp: name });
    } else if (PLAIN_VERBS.has(verb)) {
      found.push({ plain: `${tool} ${verb}` });
    } else if (verb === "find" && rest.some((t) => PLAIN_VERBS.has(t))) {
      found.push({
        plain: `${tool} find … ${rest.find((t) => PLAIN_VERBS.has(t))}`,
      });
    }
  }
  return found;
}

const DOWNLOAD_OUTPUT =
  /(Downloading (Google Chrome|Chrome|Chromium|chrome-headless-shell|Firefox|Webkit)[^\n]*|Chrome for Testing[^\n]*(downloaded|installed)[^\n]*)/i;

// Asked of the user: "restart me", "please restart". Not "restart the agent",
// which is how workers describe the documented start step and quote the docs.
const RESTART_ASK =
  /\b(restart (me|claude)|please restart|need(s)? (a|another|one more) restart|restart needed|after (a|another) restart)\b/i;

/** One `ayme` command the recorder saw: its phase, its name, the tool it
 * called, and whether it exited with an error or never answered. */
type RecordedCommand = {
  phase: Phase;
  name: string;
  tool?: string;
  failed: boolean;
};

/** The options of the `ayme` command that take the next argument as their
 * value when it is not joined with `=`. */
const AYME_VALUE_OPTIONS = new Set([
  "-s",
  "--session",
  "--params",
  "--tab",
  "--cdp",
]);

/** The `ayme` commands in the recording `file`, read as the command reads
 * its arguments; undefined without a recording. */
function recordedCommands(file: string): RecordedCommand[] | undefined {
  if (!existsSync(file)) return undefined;
  const lines = readJsonl(file);
  const ends = new Map(
    lines.filter((l) => l.event === "end").map((l) => [l.pid, l])
  );
  return lines
    .filter((l) => l.event === "start")
    .map((start) => {
      const args: string[] = start.args ?? [];
      const words = args.filter(
        (arg, at) =>
          !arg.startsWith("-") && !AYME_VALUE_OPTIONS.has(args[at - 1] ?? "")
      );
      const name = words[0] ?? args[0] ?? "(no arguments)";
      const end = ends.get(start.pid);
      return {
        phase: start.phase === "setup" ? "setup" : "task",
        name,
        tool: name === "call" ? words[1] : undefined,
        failed: end === undefined || end.code !== 0,
      };
    });
}

/** The `@ayme-dev/*` packages in the package.json `file`, each with its
 * version and its section; null without the file. */
function aymePackages(file: string): string[] | null {
  if (!existsSync(file)) return null;
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  return (
    [
      ["dependencies", ""],
      ["devDependencies", " (dev)"],
      ["peerDependencies", " (peer)"],
      ["optionalDependencies", " (optional)"],
    ] as const
  ).flatMap(([section, label]) =>
    Object.entries((manifest[section] ?? {}) as Record<string, string>)
      .filter(([name]) => name.startsWith("@ayme-dev/"))
      .map(([name, version]) => `${name}@${version}${label}`)
  );
}

function claimedOutcome(report: string): string {
  // The Outcome section only, up to the next heading: a later section can
  // say an earlier attempt failed.
  const section = /outcome[^\n]*\n?([\s\S]{0,300})/i.exec(report);
  if (!section) return "no report";
  const text = section[0].split(/\n#/)[0]!.toLowerCase();
  if (/not done|\bfailed\b|could not|cannot be done/.test(text))
    return "not done";
  if (/\bdone\b/.test(text)) return "done";
  return "unclear";
}

export function scoreRun(dir: string): Score {
  const setup = readJsonl(join(dir, "setup.jsonl"));
  const task = readJsonl(join(dir, "task.jsonl"));
  const meta = existsSync(join(dir, "meta.json"))
    ? JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"))
    : {};
  const tool: string = meta.tool ?? /free-([a-z-]+)\.out/.exec(dir)?.[1] ?? "?";
  const uses = [...toolUses(setup, "setup"), ...toolUses(task, "task")];

  const skillPhases = [
    ...new Set(
      uses
        .filter(
          (u) => u.name === "Skill" && /ayme/.test(String(u.input.skill ?? ""))
        )
        .map((u) => u.phase)
    ),
  ];

  const commands = recordedCommands(join(dir, "ayme-record.jsonl"));
  const channels = new Set<Channel>();
  let poCalls = 0;
  let poErrors = 0;
  for (const command of commands ?? []) {
    if (command.phase !== "task" || !ACTION.test(command.tool ?? "")) continue;
    channels.add("ayme");
    poCalls += 1;
    if (command.failed) poErrors += 1;
  }
  const plain: string[] = [];
  const downloads: string[] = [];
  for (const use of uses) {
    for (const found of classify(use)) {
      if (found.download) downloads.push(`${use.phase}: ${found.download}`);
      if (use.phase !== "task") continue;
      if (found.webmcp) {
        channels.add("webmcp");
        poCalls += 1;
        if (
          use.isError ||
          /isError"?\s*:\s*true|not registered|### Error/i.test(use.result)
        )
          poErrors += 1;
      }
      if (found.plain) plain.push(found.plain);
    }
    // A command's help text can describe a download ("stops before
    // downloading Chrome for Testing") without making one.
    const readsHelp = /(^|\s)(--help|-h)(\s|$)/.test(
      String(use.input.command ?? "")
    );
    const output = readsHelp ? null : DOWNLOAD_OUTPUT.exec(use.result);
    if (output && !downloads.some((d) => d.startsWith(use.phase)))
      downloads.push(`${use.phase}: ${output[0].slice(0, 80)}`);
  }
  const channel =
    channels.size === 0
      ? "none"
      : channels.size === 2
        ? "both"
        : [...channels][0]!;

  const results = [...setup, ...task].filter((e) => e.type === "result");
  // The task resumes the setup's session, and Claude Code 2.1.326 reports a
  // resumed session's cost with the earlier calls' included, so each session
  // counts once, at its last result. Turns and time are per call.
  const sessionCosts = new Map<string, number>();
  for (const r of results)
    sessionCosts.set(r.session_id ?? "", r.total_cost_usd ?? 0);
  const outcomeFile = join(dir, "outcome.json");
  const checked = existsSync(outcomeFile)
    ? JSON.parse(readFileSync(outcomeFile, "utf8"))
    : undefined;
  // A run the harness could not carry out, such as one whose model was never
  // reached, is not the worker's failure.
  const outcome = !checked
    ? "n/a"
    : checked.harnessError
      ? "harness error"
      : checked.passed
        ? "pass"
        : "fail";
  const reportFile = join(dir, "REPORT.md");

  let aymeCommands: Score["aymeCommands"] = null;
  if (commands) {
    aymeCommands = { setup: {}, task: {} };
    for (const { phase, name, failed } of commands) {
      const counted = (aymeCommands[phase][name] ??= { count: 0, failed: 0 });
      counted.count += 1;
      if (failed) counted.failed += 1;
    }
  }

  return {
    run: meta.runId ?? relative(dirname(dirname(dir)), dir),
    tool,
    outcome,
    claimed: existsSync(reportFile)
      ? claimedOutcome(readFileSync(reportFile, "utf8"))
      : "no report",
    skill: skillPhases.length ? skillPhases.join("+") : "no",
    docs: docsRead(uses),
    aymePackages: aymePackages(join(dir, "configs", "package.json")),
    channel,
    poCalls,
    poErrors,
    aymeCommands,
    plainActions: plain.length,
    plainActionList: plain,
    restartAskedInTask: assistantTexts(task).some((t) => RESTART_ASK.test(t)),
    downloads,
    turns: results.reduce((sum, r) => sum + (r.num_turns ?? 0), 0),
    seconds: Math.round(
      results.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) / 1000
    ),
    costUsd:
      Math.round(
        [...sessionCosts.values()].reduce((sum, c) => sum + c, 0) * 1000
      ) / 1000,
  };
}

/** One phase's `ayme` commands, such as `open 1, call 4 (1 failed)`. */
function commandsCell(commands: Record<string, CommandCount>): string {
  return Object.entries(commands)
    .map(
      ([name, { count, failed }]) =>
        `${name} ${count}${failed ? ` (${failed} failed)` : ""}`
    )
    .join(", ");
}

export function table(scores: Score[]): string {
  const header = [
    "Run",
    "Tool",
    "Outcome (harness)",
    "Claimed",
    "Skill",
    "Docs read",
    "ayme packages",
    "Channel",
    "PO calls (errors)",
    "ayme commands",
    "Plain actions",
    "Restart asked in task",
    "Browser downloads",
    "Turns",
    "Time (s)",
    "Cost ($)",
  ];
  const rows = scores.map((s) => [
    s.run,
    s.tool,
    s.outcome,
    s.claimed,
    s.skill,
    s.docs.join(", ") || "none",
    s.aymePackages === null ? "n/a" : s.aymePackages.join(", ") || "none",
    s.channel,
    `${s.poCalls} (${s.poErrors})`,
    s.aymeCommands === null
      ? "n/a"
      : (["setup", "task"] as const)
          .filter((phase) => Object.keys(s.aymeCommands![phase]).length > 0)
          .map((phase) => `${phase}: ${commandsCell(s.aymeCommands![phase])}`)
          .join("; ") || "none",
    s.plainActions
      ? `${s.plainActions}: ${[...new Set(s.plainActionList)].join(", ")}`
      : "0",
    s.restartAskedInTask ? "yes" : "no",
    s.downloads.length ? s.downloads.join("; ") : "none",
    String(s.turns),
    String(s.seconds),
    s.costUsd.toFixed(2),
  ]);
  const total = scores.reduce((sum, s) => sum + s.costUsd, 0);
  const passed = scores.filter((s) => s.outcome === "pass").length;
  const checked = scores.filter(
    (s) => s.outcome === "pass" || s.outcome === "fail"
  ).length;
  const escape = (cell: string) =>
    cell.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
    "",
    `${scores.length} runs, ${checked ? `${passed} of ${checked} passed the harness's check, ` : ""}total cost $${total.toFixed(2)}.`,
    "",
  ].join("\n");
}

if (import.meta.filename === process.argv[1]) {
  const { values, positionals } = parseArgs({
    options: { json: { type: "string" } },
    allowPositionals: true,
  });
  const scores = positionals.map((dir) => scoreRun(dir));
  if (values.json)
    writeFileSync(values.json, `${JSON.stringify(scores, null, 2)}\n`);
  console.log(table(scores));
}
