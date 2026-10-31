/**
 * Rebuilds a suite's summary from its stored runs, a mission suite's or a
 * startup suite's. Launches no agent and needs neither the lab app nor a
 * Claude Code token. With the OpenRouter key at hand it first fills in the Goal
 * Loop costs OpenRouter has recorded since the runs ended.
 *
 *   node src/report.ts [--suite <id>] [--publish]
 *
 * The summary lands in the suite's own folder under the ignored `results/`.
 * `--publish` also writes it to `summaries/<date>/`, or `<date>-startup/` for
 * a startup suite, which is meant to be committed. Transcripts and run folders
 * are never copied.
 */
import path from "node:path";

import { parseFlags } from "./cli.ts";
import { openRouterKeyVariable, readEnvVariable } from "./environment.ts";
import { defaultMissionId } from "./missions.ts";
import { evalRoot, summariesRoot } from "./paths.ts";
import {
  completeStoredCosts,
  isStartupSuite,
  latestSuiteId,
  readStartupSuite,
  readSuite,
  suiteDirectory,
  writeSummaryFiles,
} from "./store.ts";
import {
  buildStartupSummary,
  renderStartupSummaryMarkdown,
} from "./startupSummary.ts";
import { buildSummary, renderSummaryMarkdown } from "./summary.ts";

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

async function reportStartupSuite(suiteId: string, publish: boolean) {
  const { manifest, results } = await readStartupSuite(suiteId);
  const summary = buildStartupSummary({
    suiteId,
    date: manifest.startedAt.slice(0, 10),
    scenarios: manifest.scenarios,
    requestedRunsPerScenario: manifest.runsPerScenario,
    results,
  });
  if (manifest.error !== null)
    summary.notes.unshift(`The suite stopped early: ${manifest.error}`);
  const markdown = renderStartupSummaryMarkdown(summary);
  const suiteFolder = suiteDirectory(suiteId);
  const written = [suiteFolder];
  await writeSummaryFiles(suiteFolder, summary, markdown);
  if (publish) {
    const published = path.join(summariesRoot, `${summary.date}-startup`);
    await writeSummaryFiles(published, summary, markdown);
    written.push(published);
  }
  return { markdown, written };
}

/**
 * Builds the summary from the suite's stored runs and writes it beside the
 * manifest, after completing the Goal Loop costs OpenRouter can now report.
 * A startup suite has no Goal Loop, and a summary of its own.
 */
export async function reportSuite(
  suiteId: string,
  options: { publish: boolean; openRouterApiKey: string | undefined }
): Promise<{ markdown: string; written: string[] }> {
  if (await isStartupSuite(suiteId))
    return reportStartupSuite(suiteId, options.publish);
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
  const markdown = renderSummaryMarkdown(summary);
  const suiteFolder = suiteDirectory(suiteId);
  const written = [suiteFolder];
  await writeSummaryFiles(suiteFolder, summary, markdown);
  if (options.publish) {
    const published = path.join(summariesRoot, publishedFolder(summary));
    await writeSummaryFiles(published, summary, markdown);
    written.push(published);
  }
  return { markdown, written };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2), usage, ["publish"]);
  const suiteId = flags.get("suite") ?? (await latestSuiteId());
  if (suiteId === null)
    throw new Error("No stored suite. Run pnpm eval:suite first.");
  const { markdown, written } = await reportSuite(suiteId, {
    publish: flags.has("publish"),
    openRouterApiKey: readEnvVariable(openRouterKeyVariable, evalRoot),
  });
  process.stdout.write(markdown);
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
