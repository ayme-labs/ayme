/**
 * Reads the recording of the `ayme` commands the agent ran (see
 * `aymeRecorder.mjs`) into counts of the same shape as the transcript's tool
 * calls, so a run with the `ayme` command reports its Page Object Tool calls
 * as a run with `ayme mcp` reported `mcp__ayme__<tool>`.
 */
import type { ToolCallCounts } from "./transcript.ts";

type Line =
  | { event: "start"; t: string; pid: number; args: string[] }
  | { event: "end"; pid: number; code: number | null };

function parse(line: string): Line | null {
  try {
    const value = JSON.parse(line) as Partial<Line>;
    return value.event === "start" || value.event === "end"
      ? (value as Line)
      : null;
  } catch {
    return null;
  }
}

/** The options of the `ayme` command whose value can be the next argument. */
const valueOptions = new Set(["-s", "--session", "--params", "--tab", "--cdp"]);

/** The command's positional words: `call` and its tool, `page-objects`, and so on. */
function words(args: string[]): string[] {
  return args.filter(
    (arg, at) => !arg.startsWith("-") && !valueOptions.has(args[at - 1] ?? "")
  );
}

/** `ayme <command>`, and for a call `ayme call <tool>`. */
function commandName(args: string[]): string {
  const [command = "", tool] = words(args);
  return command === "call" && tool !== undefined
    ? `ayme call ${tool}`
    : `ayme ${command}`.trim();
}

/**
 * The commands that started within the window, `from` inclusive and `to`
 * exclusive, each counted by its name; one failed when it exited with an
 * error or never ended.
 */
export function countAymeCommands(
  record: string[],
  window: { from?: string; to?: string }
): ToolCallCounts {
  const started = new Map<number, string>();
  const ended = new Map<number, number | null>();
  for (const line of record.map(parse)) {
    if (line === null) continue;
    if (line.event === "end") {
      ended.set(line.pid, line.code);
      continue;
    }
    if (window.from !== undefined && line.t < window.from) continue;
    if (window.to !== undefined && line.t >= window.to) continue;
    started.set(line.pid, commandName(line.args));
  }
  const byTool: ToolCallCounts["byTool"] = {};
  for (const [pid, name] of [...started].sort(([, a], [, b]) =>
    a.localeCompare(b)
  )) {
    const counts = (byTool[name] ??= { total: 0, failed: 0 });
    counts.total += 1;
    if (ended.get(pid) !== 0) counts.failed += 1;
  }
  const counts = Object.values(byTool);
  return {
    total: counts.reduce((sum, { total }) => sum + total, 0),
    failed: counts.reduce((sum, { failed }) => sum + failed, 0),
    byTool,
  };
}
