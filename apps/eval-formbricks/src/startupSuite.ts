/**
 * Every startup scenario, N runs each: a startup suite. Runs round-robin
 * (run 1 of each scenario, then run 2) so a suite that stops early still holds
 * comparable runs. Writes the manifest after each run and the summary at the
 * end, under `results/suites/<suite id>/`.
 *
 *   node src/startupSuite.ts [--runs 3] [--model sonnet]
 *
 * Every run calls the model and costs money. A failed verdict is a result; the
 * first run that cannot complete ends the suite, the runs stored so far are
 * summarized and `pnpm eval:report` can rebuild the summary later.
 */
import { randomBytes } from "node:crypto";

import { parseFlags } from "./cli.ts";
import { setupTimeoutMs } from "./claude.ts";
import { reportSuite } from "./report.ts";
import { defaultModel, log } from "./run.ts";
import { startupScenarios, type StartupScenario } from "./scenarios.ts";
import { runStartup } from "./startup.ts";
import { writeManifest, type StartupManifest } from "./store.ts";

const defaultRunsPerScenario = 3;
const usage =
  "Usage: pnpm eval:startup-suite -- [--runs <count>] [--model <model>]";

type StartupSuiteOptions = {
  scenarios: StartupScenario[];
  runsPerScenario: number;
  model: string;
  timeoutMs: number;
};

export function parseStartupSuiteOptions(argv: string[]): StartupSuiteOptions {
  const flags = parseFlags(argv, usage);
  const runsPerScenario = Number(flags.get("runs") ?? defaultRunsPerScenario);
  if (!Number.isInteger(runsPerScenario) || runsPerScenario <= 0)
    throw new Error(usage);
  return {
    scenarios: Object.values(startupScenarios),
    runsPerScenario,
    model: flags.get("model") ?? defaultModel,
    timeoutMs: setupTimeoutMs,
  };
}

export async function runStartupSuite(options: StartupSuiteOptions) {
  const { scenarios, runsPerScenario, model, timeoutMs } = options;
  const startedAt = new Date().toISOString();
  const manifest: StartupManifest = {
    lane: "startup",
    suiteId: `${startedAt.replace(/[:.]/g, "-")}-startup-suite-${randomBytes(3).toString("hex")}`,
    startedAt,
    finishedAt: null,
    model,
    timeoutSeconds: timeoutMs / 1000,
    scenarios: scenarios.map(({ id }) => id),
    runsPerScenario,
    runIds: [],
    error: null,
  };
  await writeManifest(manifest);
  log(
    `Suite ${manifest.suiteId}: ${manifest.scenarios.join(", ")}, ${runsPerScenario} run(s) each, ${model}.`
  );

  try {
    for (let round = 1; round <= runsPerScenario; round += 1) {
      for (const scenario of scenarios) {
        log(`Run ${round} of ${runsPerScenario}: ${scenario.id}.`);
        const { result } = await runStartup({ scenario, model, timeoutMs });
        log(`${result.runId}: ${result.pass ? "pass" : "fail"}.`);
        manifest.runIds.push(result.runId);
        await writeManifest(manifest);
      }
    }
  } catch (error) {
    manifest.error = error instanceof Error ? error.message : String(error);
    log(`The suite stopped early: ${manifest.error}`);
  }

  manifest.finishedAt = new Date().toISOString();
  await writeManifest(manifest);
  const report = await reportSuite(manifest.suiteId, {
    publish: false,
    openRouterApiKey: undefined,
  });
  return { manifest, ...report };
}

async function main() {
  const { manifest, markdown, written } = await runStartupSuite(
    parseStartupSuiteOptions(process.argv.slice(2))
  );
  process.stdout.write(markdown);
  log(`Summary written to ${written.join(", ")}.`);
  process.exitCode = manifest.error === null ? 0 : 2;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  });
}
