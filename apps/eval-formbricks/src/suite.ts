/**
 * The chosen arms, N runs each, one model, one timeout: a suite. Checks the
 * preconditions and warms the lab app once, outside every measured window,
 * then runs round-robin across the arms (run 1 of each arm, then run 2) so
 * a suite that stops early still holds comparable runs. Each run seeds its
 * own mission. Writes the suite's manifest and summary under
 * `results/suites/<suite id>/`.
 *
 *   node src/suite.ts [--arms a,b] [--runs 3] [--model sonnet] [--timeout-seconds 600] [--mission <id>]
 *
 * Every run calls the model and costs money. The first run that cannot
 * complete ends the suite, since the lab app or the environment is then
 * suspect; the runs stored so far are summarized and `pnpm eval:report` can
 * rebuild the summary later.
 */
import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { armIds, arms, isArmId, type ArmId } from "./arms.ts";
import { parseFlags } from "./cli.ts";
import { claudeEnvironment } from "./claude.ts";
import {
  openRouterKeyVariable,
  readEnvVariable,
  readOauthToken,
} from "./environment.ts";
import { ensureDatabaseBuilt } from "./formbricks/database.ts";
import {
  defaultMissionId,
  missionDefinitions,
  type MissionDefinition,
} from "./missions.ts";
import { evalRoot, formbricksRoot, labUrl } from "./paths.ts";
import {
  checkPreconditions,
  claudeTokenPrecondition,
  dockerPrecondition,
  formbricksPreparedPrecondition,
  labAppPrecondition,
} from "./preconditions.ts";
import { reportSuite } from "./report.ts";
import { defaultModel, defaultTimeoutSeconds, log, runOnce } from "./run.ts";
import { renderSummaryMarkdown } from "./summary.ts";
import { suiteDirectory, writeManifest, type SuiteManifest } from "./store.ts";
import { warmLabApp } from "./warmup.ts";

const defaultRunsPerArm = 3;

type SuiteOptions = {
  arms: ArmId[];
  runsPerArm: number;
  model: string;
  timeoutSeconds: number;
  mission: MissionDefinition;
};

function usage() {
  return `Usage: pnpm eval:suite -- [--arms <${armIds.join("|")}>[,...]] [--runs <count>] [--model <model>] [--timeout-seconds <seconds>] [--mission <${Object.keys(missionDefinitions).join("|")}>]`;
}

export function parseSuiteOptions(argv: string[]): SuiteOptions {
  const flags = parseFlags(argv, usage());
  const chosen = flags.get("arms")?.split(",") ?? armIds;
  if (chosen.length === 0 || !chosen.every(isArmId)) throw new Error(usage());
  const runsPerArm = Number(flags.get("runs") ?? defaultRunsPerArm);
  const timeoutSeconds = Number(
    flags.get("timeout-seconds") ?? defaultTimeoutSeconds
  );
  const mission = missionDefinitions[flags.get("mission") ?? defaultMissionId];
  if (
    mission === undefined ||
    !Number.isInteger(runsPerArm) ||
    runsPerArm <= 0 ||
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds <= 0
  )
    throw new Error(usage());
  return {
    arms: [...new Set(chosen)],
    runsPerArm,
    model: flags.get("model") ?? defaultModel,
    timeoutSeconds,
    mission,
  };
}

async function main() {
  const options = parseSuiteOptions(process.argv.slice(2));
  const startedAt = new Date();
  const suiteId = `${startedAt.toISOString().replace(/[:.]/g, "-")}-suite-${randomBytes(3).toString("hex")}`;
  const suiteDir = suiteDirectory(suiteId);
  const configCheckDir = path.join(suiteDir, "claude-config-check");
  await mkdir(configCheckDir, { recursive: true });

  log("Checking preconditions.");
  try {
    const oauthToken = readOauthToken(evalRoot);
    await checkPreconditions([
      claudeTokenPrecondition({
        environment:
          oauthToken === undefined
            ? undefined
            : claudeEnvironment({ configDir: configCheckDir, oauthToken }),
        envDirectory: evalRoot,
      }),
      dockerPrecondition,
      labAppPrecondition(labUrl),
      formbricksPreparedPrecondition(formbricksRoot),
      // Once each: the two Ayme arms share theirs.
      ...new Set(
        options.arms.flatMap((armId) => arms[armId].preconditions ?? [])
      ),
    ]);
  } catch (error) {
    await rm(suiteDir, { recursive: true, force: true });
    throw error;
  }
  await rm(configCheckDir, { recursive: true, force: true });
  ensureDatabaseBuilt(formbricksRoot, log);

  log("Warming the lab app.");
  try {
    await warmLabApp({
      suiteId,
      formbricksRoot,
      baseUrl: labUrl,
      workDir: suiteDir,
      log,
    });
  } catch (error) {
    // No manifest yet: a folder without one would be the newest suite for the report command.
    await rm(suiteDir, { recursive: true, force: true });
    throw error;
  }

  const manifest: SuiteManifest = {
    suiteId,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    model: options.model,
    timeoutSeconds: options.timeoutSeconds,
    mission: options.mission.id,
    arms: options.arms,
    runsPerArm: options.runsPerArm,
    runIds: [],
    error: null,
  };
  await writeManifest(manifest);
  log(
    `Suite ${suiteId}: ${options.arms.join(", ")}, ${options.runsPerArm} run(s) each, ${options.model}.`
  );

  try {
    for (let round = 1; round <= options.runsPerArm; round += 1) {
      for (const armId of options.arms) {
        log(`Run ${round} of ${options.runsPerArm}: ${armId}.`);
        const { runId, result } = await runOnce({
          arm: arms[armId],
          mission: options.mission,
          model: options.model,
          timeoutSeconds: options.timeoutSeconds,
        });
        log(`${runId}: ${result.pass ? "pass" : "fail"}.`);
        manifest.runIds.push(runId);
        await writeManifest(manifest);
      }
    }
  } catch (error) {
    manifest.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 2;
    log(`The suite stopped early: ${manifest.error}`);
  }

  manifest.finishedAt = new Date().toISOString();
  await writeManifest(manifest);
  const { summary, written } = await reportSuite(suiteId, {
    publish: false,
    openRouterApiKey: readEnvVariable(openRouterKeyVariable, evalRoot),
  });
  process.stdout.write(renderSummaryMarkdown(summary));
  log(`Summary written to ${written.join(", ")}.`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  });
}
