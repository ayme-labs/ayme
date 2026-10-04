/**
 * One mission, once, through one arm. Checks preconditions, seeds, signs in,
 * runs Claude Code, reads the verdict from the database and stores the run.
 *
 *   node src/run.ts --arm playwright-mcp [--model sonnet] [--timeout-seconds 600] [--mission <id>]
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  arms,
  armIds,
  isArmId,
  type Arm,
  type ArmContext,
  type ArmSetup,
} from "./arms.ts";
import { initPageScript, signInAndOpenEditor } from "./browser.ts";
import { claudeEnvironment, claudeVersion, runClaude } from "./claude.ts";
import { readOauthToken } from "./environment.ts";
import {
  ensureDatabaseBuilt,
  openFormbricksDatabase,
  readSurvey,
  seedMission,
  waitForAuthorizationProjection,
} from "./formbricks/database.ts";
import {
  defaultMissionId,
  missionDefinitions,
  type MissionDefinition,
} from "./missions.ts";
import { normalizeRun, summarizeResult } from "./normalize.ts";
import {
  evalRoot,
  formbricksRoot,
  labRoot,
  labUrl,
  repoRoot,
  runsRoot,
} from "./paths.ts";
import {
  checkPreconditions,
  claudeTokenPrecondition,
  dockerPrecondition,
  formbricksPreparedPrecondition,
  labAppPrecondition,
} from "./preconditions.ts";
import { createPrompt } from "./prompt.ts";
import { judgeMission } from "./verdict.ts";

type Options = {
  arm: Arm;
  mission: MissionDefinition;
  model: string;
  timeoutSeconds: number;
};

function usage() {
  return `Usage: pnpm eval:run -- --arm <${armIds.join("|")}> [--model <model>] [--timeout-seconds <seconds>] [--mission <${Object.keys(missionDefinitions).join("|")}>]`;
}

function parseOptions(argv: string[]): Options {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(usage());
    values.set(key.slice(2), value);
  }
  const arm = values.get("arm");
  if (arm === undefined || !isArmId(arm)) throw new Error(usage());
  const missionId = values.get("mission") ?? defaultMissionId;
  const mission = missionDefinitions[missionId];
  if (mission === undefined) throw new Error(usage());
  const timeoutSeconds = Number(values.get("timeout-seconds") ?? "600");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0)
    throw new Error(usage());
  return {
    arm: arms[arm],
    mission,
    model: values.get("model") ?? "sonnet",
    timeoutSeconds,
  };
}

function log(line: string) {
  process.stderr.write(`[${new Date().toISOString()}] ${line}\n`);
}

function gitOutput(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function labCheckoutDirty() {
  const status = gitOutput(repoRoot, [
    "status",
    "--porcelain",
    "--",
    "apps/lab-formbricks",
  ]);
  const submodule = gitOutput(formbricksRoot, ["status", "--porcelain"]);
  return (
    status === null || submodule === null || status !== "" || submodule !== ""
  );
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const options = parseOptions(process.argv.slice(2));

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${options.arm.id}-${randomBytes(3).toString("hex")}`;
  const runDir = path.join(runsRoot, runId);
  const profileDir = path.join(runDir, "browser-profile");
  const outputDir = path.join(runDir, "playwright-output");
  const initPagePath = path.join(runDir, "init-page.cjs");
  const mcpConfigPath = path.join(runDir, "mcp.json");
  // A fresh, empty Claude Code configuration for this run alone; deleted with the browser profile.
  const claudeConfigDir = path.join(runDir, "claude-config");
  await mkdir(profileDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(claudeConfigDir, { recursive: true });

  const oauthToken = readOauthToken(evalRoot);
  const environment =
    oauthToken === undefined
      ? undefined
      : claudeEnvironment({ configDir: claudeConfigDir, oauthToken });

  log("Checking preconditions.");
  try {
    await checkPreconditions([
      claudeTokenPrecondition({ environment, envDirectory: evalRoot }),
      dockerPrecondition,
      labAppPrecondition(labUrl),
      formbricksPreparedPrecondition(formbricksRoot),
    ]);
  } catch (error) {
    await rm(runDir, { recursive: true, force: true });
    throw error;
  }
  if (environment === undefined) throw new Error("unreachable: no environment");
  ensureDatabaseBuilt(formbricksRoot, log);
  log(`Run ${runId}: ${runDir}`);

  const database = await openFormbricksDatabase(formbricksRoot);
  let armSetup: ArmSetup | undefined;
  try {
    log("Seeding the mission.");
    const mission = await seedMission(database, options.mission, runId, labUrl);
    await writeJson(path.join(runDir, "mission.json"), mission);
    const projection = await waitForAuthorizationProjection(database, mission, {
      timeoutMs: 60_000,
    });
    log(
      `Authorization projection processed ${projection.rows} rows in ${projection.waitedMs} ms.`
    );

    log("Signing in and opening the editor.");
    const { browserVersion } = await signInAndOpenEditor({
      mission,
      baseUrl: labUrl,
      profileDir,
      channel: "chrome",
      log,
    });

    const armContext: ArmContext = {
      runId,
      runDir,
      profileDir,
      outputDir,
      initPagePath,
      configDir: claudeConfigDir,
      startUrl: mission.startUrl,
      cwd: labRoot,
      log,
    };
    const prompt = createPrompt(mission, options.arm, labUrl);
    await writeFile(path.join(runDir, "prompt.txt"), prompt);
    await writeFile(initPagePath, initPageScript(mission.startUrl));
    await writeJson(mcpConfigPath, {
      mcpServers: options.arm.mcpServers(armContext),
    });
    // Whatever the arm's interface needs outside the measured window.
    armSetup = await options.arm.setup?.(armContext);

    log(
      `Starting the agent (${options.arm.id}, ${options.model}, ${options.timeoutSeconds} s).`
    );
    const run = await runClaude({
      cwd: labRoot,
      environment: { ...environment, ...armSetup?.environment },
      model: options.model,
      arm: options.arm,
      mcpConfigPath,
      readableDirectories: armSetup?.readableDirectories,
      prompt,
      timeoutMs: options.timeoutSeconds * 1000,
      transcriptPath: path.join(runDir, "transcript.jsonl"),
      stderrPath: path.join(runDir, "stderr.log"),
    });
    log(
      `Agent finished: exit ${run.exitCode ?? run.signal}, timed out ${run.timedOut}, ${run.lines.length} events.`
    );

    log("Reading the verdict from the database.");
    const verdict = judgeMission(
      mission,
      await readSurvey(database, mission.surveyId)
    );
    await writeJson(path.join(runDir, "verdict.json"), verdict);

    const result = normalizeRun({
      runId,
      arm: options.arm.id,
      missionId: mission.id,
      requestedModel: options.model,
      timeoutSeconds: options.timeoutSeconds,
      transcript: run.lines,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      wallTimeMs: run.wallTimeMs,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      verdict,
      versions: {
        claudeCode: claudeVersion(),
        browserInterface: options.arm.browserInterface(),
        browser: browserVersion,
        formbricksCommit: gitOutput(formbricksRoot, ["rev-parse", "HEAD"]),
        aymeCommit: gitOutput(repoRoot, ["rev-parse", "HEAD"]),
      },
      goalLoop: { usage: null, costUsd: null },
      labCheckoutDirty: labCheckoutDirty(),
    });
    await writeFile(
      path.join(runDir, "final.md"),
      result.agent.finalMessage ?? "(the agent produced no final message)\n"
    );
    await writeJson(path.join(runDir, "result.json"), result);
    const summary = summarizeResult(result);
    await writeFile(path.join(runDir, "summary.md"), summary);
    process.stdout.write(summary);
    if (result.labCheckoutDirty)
      log(
        "Warning: the lab app checkout changed during the run. Inspect it before the next run."
      );
    process.exitCode = result.pass ? 0 : 1;
  } finally {
    await armSetup?.dispose();
    await database.close();
    await rm(profileDir, { recursive: true, force: true });
    await rm(claudeConfigDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 2;
});
