/**
 * Rebuilds a suite's summary from its stored runs. Launches no agent and
 * needs neither the lab app nor a Claude Code token. With the OpenRouter key
 * at hand it first fills in the Goal Loop costs OpenRouter has recorded since
 * the runs ended.
 *
 *   node src/report.ts [--suite <id>] [--publish]
 *
 * The summary lands in the suite's own folder under the ignored `results/`.
 * `--publish` also writes it to `summaries/<date>/`, which is meant to be
 * committed. Transcripts and run folders are never copied.
 */
import path from "node:path";

import { parseFlags } from "./cli.ts";
import { openRouterKeyVariable, readEnvVariable } from "./environment.ts";
import { defaultMissionId } from "./missions.ts";
import { evalRoot, summariesRoot } from "./paths.ts";
import {
  completeStoredCosts,
  latestSuiteId,
  readSuite,
  suiteDirectory,
  writeSummaryFiles,
} from "./store.ts";
import {
  buildSummary,
  renderSummaryMarkdown,
  type SuiteSummary,
} from "./summary.ts";

const usage = "Usage: pnpm eval:report -- [--suite <suite id>] [--publish]";

/**
 * The published summary's folder: the date for the default mission, so its
 * dated tables keep their paths, and the date with the mission for any other.
 */
export function publishedFolder(summary: { date: string; missions: string[] }) {
  const [mission] = summary.missions;
  return summary.missions.length === 1 && mission !== defaultMissionId
    ? `${summary.date}-${mission}`
    : summary.date;
}

const log = (line: string) => process.stderr.write(`${line}\n`);

/**
 * Builds the summary from the suite's stored runs and writes it beside the
 * manifest, after completing the Goal Loop costs OpenRouter can now report.
 */
export async function reportSuite(
  suiteId: string,
  options: { publish: boolean; openRouterApiKey: string | undefined }
): Promise<{ summary: SuiteSummary; written: string[] }> {
  const { manifest: stored } = await readSuite(suiteId);
  if (options.openRouterApiKey !== undefined) {
    const completed = await completeStoredCosts(stored.runIds, {
      openRouterApiKey: options.openRouterApiKey,
      log,
    });
    if (completed.length > 0)
      log(`Filled in the Goal Loop cost of ${completed.join(", ")}.`);
  }
  const { manifest, results } = await readSuite(suiteId);
  const summary = buildSummary({
    suiteId,
    date: manifest.startedAt.slice(0, 10),
    arms: manifest.arms,
    requestedRunsPerArm: manifest.runsPerArm,
    results,
  });
  if (manifest.error !== null)
    summary.notes.unshift(`The suite stopped early: ${manifest.error}`);
  const suiteFolder = suiteDirectory(suiteId);
  const written = [suiteFolder];
  await writeSummaryFiles(suiteFolder, summary);
  if (options.publish) {
    const published = path.join(summariesRoot, publishedFolder(summary));
    await writeSummaryFiles(published, summary);
    written.push(published);
  }
  return { summary, written };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2), usage, ["publish"]);
  const suiteId = flags.get("suite") ?? (await latestSuiteId());
  if (suiteId === null)
    throw new Error("No stored suite. Run pnpm eval:suite first.");
  const { summary, written } = await reportSuite(suiteId, {
    publish: flags.has("publish"),
    openRouterApiKey: readEnvVariable(openRouterKeyVariable, evalRoot),
  });
  process.stdout.write(renderSummaryMarkdown(summary));
  process.stderr.write(
    `Wrote summary.md and summary.json to:\n${written.map((directory) => `- ${directory}`).join("\n")}\n`
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  });
}
