/**
 * The startup lane: one scenario, once. Measures only the agent's first turn
 * after loading the skill, with no browser, no running app and no MCP server,
 * and reads the verdict from the transcript. It needs Claude Code and a token
 * and nothing else. `runStartup` is what a suite calls; the command below
 * wraps it.
 *
 *   node src/startup.ts [--scenario <id>] [--model sonnet]
 */
import { randomBytes } from "node:crypto";
import { cp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { aymeSkillDirectory, aymeSkillName, aymeSkillSource } from "./ayme.ts";
import { parseFlags } from "./cli.ts";
import {
  agentEffort,
  claudeEnvironment,
  runClaude,
  setupTimeoutMs,
  type ClaudeRun,
} from "./claude.ts";
import { readOauthToken } from "./environment.ts";
import { evalRoot, labRoot, repoRoot, runsRoot } from "./paths.ts";
import {
  checkPreconditions,
  claudeTokenPrecondition,
} from "./preconditions.ts";
import { readyLine } from "./prompt.ts";
import { defaultModel, gitOutput, log, writeJson } from "./run.ts";
import {
  defaultScenarioId,
  startupScenarios,
  type StartupScenario,
} from "./scenarios.ts";
import {
  summarizeTranscript,
  toolCalls,
  type TokenUsage,
} from "./transcript.ts";

/** The agent's tools: `Read`, so no reference is seen without counting as read, and the Skill tool, allowed for the one skill. */
const agentTools = {
  tools: ["Read", "Skill"],
  allowedTools: [`Skill(${aymeSkillName})`],
};

export type StartupOptions = {
  scenario: StartupScenario;
  model: string;
  timeoutMs: number;
};

export type StartupResult = {
  runId: string;
  scenario: string;
  /** No condition failed. */
  pass: boolean;
  /** Each condition that failed, by name, with what was found. */
  failed: { condition: string; detail: string }[];
  /** From sending the message to its result event. */
  wallTimeMs: number | null;
  tokens: TokenUsage | null;
  /** In the order first read: paths inside the skill's folder relative to it, any other absolute. */
  filesRead: string[];
  timeoutSeconds: number;
  versions: {
    claudeCode: string | null;
    model: { requested: string; used: string | null; effort: string };
    aymeCommit: string | null;
  };
  startedAt: string;
  finishedAt: string;
};

function list(items: string[]) {
  return items.join(", ") || "nothing";
}

/** The verdict from the transcript; a tool outside the lane's own can only be a browser or MCP tool. */
function judge(scenario: StartupScenario, run: ClaudeRun, skillDir: string) {
  const calls = toolCalls(run.lines);
  const skillLoaded = calls.some(
    ({ name, input, succeeded }) =>
      name === "Skill" && input.skill === aymeSkillName && succeeded
  );
  const reads = calls
    .filter(({ name, succeeded }) => name === "Read" && succeeded)
    .map(({ input }) => String(input.file_path))
    .map((file) => {
      const relative = path.relative(skillDir, file);
      return relative.startsWith("..") ? file : relative;
    });
  const filesRead = [...new Set(reads)];
  const forbidden = filesRead.filter((file) =>
    scenario.forbidden?.includes(file)
  );
  const allTools = calls.map(({ name }) => name);
  const otherTools = [...new Set(allTools)].filter(
    (name) => !agentTools.tools.includes(name)
  );
  const [turn] = summarizeTranscript(run.lines).turns;
  const denials = turn?.result?.permissionDenials ?? 0;
  const conditions = [
    {
      condition: "skill-loaded",
      holds: skillLoaded,
      detail: `the Skill tool did not load ${aymeSkillName}`,
    },
    {
      condition: "expected-files-read",
      holds:
        filesRead.length === scenario.expected.length &&
        filesRead.every((file) => scenario.expected.includes(file)),
      detail: `expected ${list(scenario.expected)}; read ${list(filesRead)}`,
    },
    {
      condition: "no-forbidden-file",
      holds: forbidden.length === 0,
      detail: `read ${list(forbidden)}`,
    },
    {
      condition: "nothing-denied",
      holds: denials === 0,
      detail: `permission denials: ${denials}`,
    },
    {
      condition: "no-browser-or-mcp-tool",
      holds: otherTools.length === 0,
      detail: `called ${list(otherTools)}`,
    },
    {
      condition: "within-setup-timeout",
      holds: !run.setup.timedOut,
      detail: run.setupFailure ?? "",
    },
  ];
  return {
    filesRead,
    failed: conditions
      .filter(({ holds }) => !holds)
      .map(({ condition, detail }) => ({ condition, detail })),
    turn,
  };
}

/**
 * Runs the scenario once and stores it under `results/runs/<run id>/`.
 * Throws when the run cannot complete; a failed verdict, a timed-out setup
 * turn included, is a result, not an error.
 */
export async function runStartup(
  options: StartupOptions
): Promise<{ runDir: string; result: StartupResult }> {
  const { scenario, model, timeoutMs } = options;
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-startup-${scenario.id}-${randomBytes(3).toString("hex")}`;
  const runDir = path.join(runsRoot, runId);
  // A fresh, empty Claude Code configuration for this run alone, deleted after it.
  const claudeConfigDir = path.join(runDir, "claude-config");
  const oauthToken = readOauthToken(evalRoot);
  const environment =
    oauthToken === undefined
      ? undefined
      : claudeEnvironment({ configDir: claudeConfigDir, oauthToken });

  log("Checking preconditions.");
  await checkPreconditions([
    claudeTokenPrecondition({ environment, envDirectory: evalRoot }),
  ]);
  if (environment === undefined) throw new Error("unreachable: no environment");
  log(`Run ${runId}: ${runDir}`);

  try {
    const skillDir = aymeSkillDirectory(claudeConfigDir);
    await cp(aymeSkillSource, skillDir, { recursive: true });
    const message = `${scenario.framing} ${readyLine({ skill: aymeSkillName, readsSkillReferences: true })}\n`;
    const mcpConfigPath = path.join(runDir, "mcp.json");
    await writeFile(path.join(runDir, "setup-prompt.txt"), message);
    await writeJson(mcpConfigPath, { mcpServers: {} });

    log(
      `Starting the agent (${scenario.id}, ${model}, ${timeoutMs / 1000} s).`
    );
    const run = await runClaude({
      cwd: labRoot,
      environment,
      model,
      arm: agentTools,
      mcpConfigPath,
      readableDirectories: [skillDir],
      setupPrompt: message,
      setupTimeoutMs: timeoutMs,
      transcriptPath: path.join(runDir, "transcript.jsonl"),
      stderrPath: path.join(runDir, "stderr.log"),
    });
    // An error says nothing about routing: as for a mission, the run could not complete and the transcript stays.
    if (run.setupFailure !== null && !run.setup.timedOut)
      throw new Error(
        `The run could not complete: ${run.setupFailure}. The transcript is in ${runDir}.`
      );
    const { filesRead, failed, turn } = judge(scenario, run, skillDir);
    const result: StartupResult = {
      runId,
      scenario: scenario.id,
      pass: failed.length === 0,
      failed,
      wallTimeMs: run.setup.wallTimeMs,
      tokens: turn?.result?.usage ?? null,
      filesRead,
      timeoutSeconds: timeoutMs / 1000,
      versions: {
        claudeCode: turn?.init?.claudeCodeVersion ?? null,
        model: {
          requested: model,
          used: turn?.init?.model ?? null,
          effort: agentEffort,
        },
        aymeCommit: gitOutput(repoRoot, ["rev-parse", "HEAD"]),
      },
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };
    await writeJson(path.join(runDir, "result.json"), result);
    return { runDir, result };
  } finally {
    await rm(claudeConfigDir, { recursive: true, force: true });
  }
}

function parseOptions(argv: string[]): StartupOptions {
  const usage = `Usage: pnpm eval:startup -- [--scenario <${Object.keys(startupScenarios).join("|")}>] [--model <model>]`;
  const values = parseFlags(argv, usage);
  const scenario =
    startupScenarios[values.get("scenario") ?? defaultScenarioId];
  if (scenario === undefined) throw new Error(usage);
  return {
    scenario,
    model: values.get("model") ?? defaultModel,
    timeoutMs: setupTimeoutMs,
  };
}

async function main() {
  const { result } = await runStartup(parseOptions(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.pass ? 0 : 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  });
}
