/**
 * Scores a run from its files alone: the two stream-json transcripts, the
 * harness's outcome check, the worker's REPORT.md and the `ayme mcp`
 * recording. Works on any folder with setup.jsonl and task.jsonl, so older
 * hand-run rounds score the same way.
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

import { TOOLS, type Tool } from "./prompts.ts";

type Channel = "mcp" | "webmcp";

/** The channel the skill's browser-automation-tools.md names first for each tool. */
export const DEFAULT_CHANNEL: Record<Tool, Channel> = {
  "playwright-cli": "webmcp",
  "playwright-mcp": "mcp",
  "agent-browser": "mcp",
};

export type Score = {
  run: string;
  tool: string;
  outcome: "pass" | "fail" | "n/a";
  claimed: string;
  skill: string;
  docs: string[];
  channel: string;
  defaultChannel: string;
  matchesDefault: boolean | null;
  poCalls: number;
  poErrors: number;
  plainActions: number;
  plainActionList: string[];
  restartAskedInTask: boolean;
  downloads: string[];
  turns: number;
  seconds: number;
  costUsd: number;
  aymeStarts: number | null;
  aymeFailedStarts: number | null;
};

type Event = Record<string, any>;
type ToolUse = {
  phase: "setup" | "task";
  name: string;
  input: any;
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

function toolUses(events: Event[], phase: "setup" | "task"): ToolUse[] {
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
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text as string)
      : []
  );
}

/** A Bash command split into simple commands, with `X=...tool...` variables resolved. */
function segments(command: string): { cwd: string; tokens: string[] }[] {
  let text = command;
  for (const match of command.matchAll(
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
const PLAIN_MCP =
  /^browser_(click|type|fill_form|press_key|select_option|hover|drag)$/;

type Classified = {
  channel?: Channel;
  action?: string;
  plain?: string;
  download?: string;
};

/** What one tool call did: a Page Object action through a channel, a plain browser action, or a browser download. */
function classify(use: ToolUse): Classified[] {
  const found: Classified[] = [];
  const mcp = /^mcp__(.+?)__(.+)$/.exec(use.name);
  if (mcp) {
    const tool = mcp[2]!;
    if (tool.startsWith("webmcp_")) {
      const name = tool.slice("webmcp_".length);
      if (ACTION.test(name)) found.push({ channel: "webmcp", action: name });
    } else if (ACTION.test(tool)) {
      found.push({ channel: "mcp", action: tool });
    } else if (
      tool === "ayme_call" &&
      ACTION.test(String(use.input.tool ?? ""))
    ) {
      found.push({ channel: "mcp", action: String(use.input.tool) });
    } else if (PLAIN_MCP.test(tool)) {
      found.push({ plain: tool });
    } else if (tool === "browser_install") {
      found.push({ download: "browser_install" });
    }
    return found;
  }
  if (use.name !== "Bash") return found;
  for (const { tokens } of segments(String(use.input.command ?? ""))) {
    const install = tokens.findIndex(
      (t, i) =>
        t === "install-browser" ||
        (t === "install" &&
          /playwright|agent-browser|cli\.js$/.test(tokens[i - 1] ?? ""))
    );
    if (install >= 0) {
      found.push({
        download: tokens
          .slice(Math.max(0, install - 1), install + 2)
          .map((t) => basename(t))
          .join(" "),
      });
      continue;
    }
    const at = tokens.findIndex((t) =>
      /(^|\/)(playwright-cli|agent-browser)$/.test(t)
    );
    if (at < 0) continue;
    const rest = tokens.slice(at + 1);
    const verbAt = rest.findIndex(
      (t) =>
        !t.startsWith("-") &&
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
      if (name) found.push({ channel: "webmcp", action: name });
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
  /(Downloading (Google Chrome|Chrome|Chromium|chrome-headless-shell|Firefox|Webkit|FFMPEG)[^\n]*|Chrome for Testing[^\n]*(downloaded|installed)[^\n]*)/i;

const RESTART_ASK =
  /\b(restart (me|claude|the (session|agent|conversation))|please restart|need(s)? (a|another) restart|restart needed|after (a|another) restart)\b/i;

function claimedOutcome(report: string): string {
  const section = /outcome[^\n]*\n?([\s\S]{0,300})/i.exec(report);
  if (!section) return "no report";
  const text = section[0].toLowerCase();
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
  const taskUses = uses.filter((u) => u.phase === "task");

  const skillPhases = [
    ...new Set(
      uses
        .filter(
          (u) => u.name === "Skill" && /ayme/.test(String(u.input.skill ?? ""))
        )
        .map((u) => u.phase)
    ),
  ];

  const channels = new Set<Channel>();
  let poCalls = 0;
  let poErrors = 0;
  const plain: string[] = [];
  const downloads: string[] = [];
  for (const use of uses) {
    for (const found of classify(use)) {
      if (found.download) downloads.push(`${use.phase}: ${found.download}`);
      if (use.phase !== "task") continue;
      if (found.channel) {
        channels.add(found.channel);
        poCalls += 1;
        if (
          use.isError ||
          /isError"?\s*:\s*true|not registered|### Error/i.test(use.result)
        )
          poErrors += 1;
      }
      if (found.plain) plain.push(found.plain);
    }
    const output = DOWNLOAD_OUTPUT.exec(use.result);
    if (output && !downloads.some((d) => d.startsWith(use.phase)))
      downloads.push(`${use.phase}: ${output[0].slice(0, 80)}`);
  }
  const channel =
    channels.size === 0
      ? "none"
      : channels.size === 2
        ? "both"
        : [...channels][0]!;
  const defaultChannel = TOOLS.includes(tool as Tool)
    ? DEFAULT_CHANNEL[tool as Tool]
    : "?";

  const results = [...setup, ...task].filter((e) => e.type === "result");
  const outcomeFile = join(dir, "outcome.json");
  const outcome = existsSync(outcomeFile)
    ? JSON.parse(readFileSync(outcomeFile, "utf8")).passed
      ? "pass"
      : "fail"
    : "n/a";
  const reportFile = join(dir, "REPORT.md");

  const record = join(dir, "ayme-record.jsonl");
  let aymeStarts: number | null = null;
  let aymeFailedStarts: number | null = null;
  if (existsSync(record)) {
    const lines = readJsonl(record);
    aymeStarts = lines.filter((l) => l.dir === "start").length;
    aymeFailedStarts = lines.filter(
      (l) => l.dir === "exit" && l.line !== "0"
    ).length;
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
    channel,
    defaultChannel,
    matchesDefault: channel === "none" ? null : channel === defaultChannel,
    poCalls,
    poErrors,
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
        results.reduce((sum, r) => sum + (r.total_cost_usd ?? 0), 0) * 1000
      ) / 1000,
    aymeStarts,
    aymeFailedStarts,
  };
}

export function table(scores: Score[]): string {
  const header = [
    "Run",
    "Tool",
    "Outcome (harness)",
    "Claimed",
    "Skill",
    "Docs read",
    "Channel (default)",
    "PO calls (errors)",
    "Plain actions",
    "Restart asked in task",
    "Browser downloads",
    "Turns",
    "Time (s)",
    "Cost ($)",
    "ayme mcp starts (non-zero exits)",
  ];
  const rows = scores.map((s) => [
    s.run,
    s.tool,
    s.outcome,
    s.claimed,
    s.skill,
    s.docs.join(", ") || "none",
    `${s.channel} (${s.defaultChannel}${s.matchesDefault === null ? "" : s.matchesDefault ? ", same" : ", other"})`,
    `${s.poCalls} (${s.poErrors})`,
    s.plainActions
      ? `${s.plainActions}: ${[...new Set(s.plainActionList)].join(", ")}`
      : "0",
    s.restartAskedInTask ? "yes" : "no",
    s.downloads.length ? s.downloads.join("; ") : "none",
    String(s.turns),
    String(s.seconds),
    s.costUsd.toFixed(2),
    s.aymeStarts === null ? "n/a" : `${s.aymeStarts} (${s.aymeFailedStarts})`,
  ]);
  const total = scores.reduce((sum, s) => sum + s.costUsd, 0);
  const passed = scores.filter((s) => s.outcome === "pass").length;
  const checked = scores.filter((s) => s.outcome !== "n/a").length;
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
