/**
 * Rebuilds a suite's summary from its stored runs, a mission suite's or a
 * startup suite's. Launches no agent and needs neither the lab app nor a
 * Claude Code token.
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
import { defaultMissionId } from "./missions.ts";
import { summariesRoot } from "./paths.ts";
import {
  latestSuiteId,
  parseStartupRun,
  parseStoredRun,
  readManifest,
  readResults,
  suiteDirectory,
  writeSummaryFiles,
  type StartupManifest,
} from "./store.ts";
import {
  buildStartupSummary,
  renderStartupSummaryMarkdown,
  withoutLocalPaths,
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

/** Writes the summary beside the manifest and, when given a folder, there too. */
async function writeSummaries(
  summary: { suiteId: string },
  markdown: string,
  published: string | null
) {
  const written = [suiteDirectory(summary.suiteId)];
  if (published !== null) written.push(published);
  for (const directory of written)
    await writeSummaryFiles(directory, summary, markdown);
  return { markdown, written };
}

async function reportStartupSuite(
  suiteId: string,
  manifest: StartupManifest,
  publish: boolean
) {
  const summary = buildStartupSummary({
    suiteId,
    date: manifest.startedAt.slice(0, 10),
    scenarios: manifest.scenarios,
    requestedRunsPerScenario: manifest.runsPerScenario,
    results: await readResults(manifest.runIds, parseStartupRun),
  });
  if (manifest.error !== null)
    summary.notes.unshift(
      `The suite stopped early: ${withoutLocalPaths(manifest.error)}`
    );
  return writeSummaries(
    summary,
    renderStartupSummaryMarkdown(summary),
    publish ? path.join(summariesRoot, `${summary.date}-startup`) : null
  );
}

/**
 * Builds the summary from the suite's stored runs and writes it beside the
 * manifest. A startup suite has a summary of its own.
 */
export async function reportSuite(
  suiteId: string,
  options: { publish: boolean }
): Promise<{ markdown: string; written: string[] }> {
  const manifest = await readManifest(suiteId);
  if ("lane" in manifest)
    return reportStartupSuite(suiteId, manifest, options.publish);
  const summary = buildSummary({
    suiteId,
    date: manifest.startedAt.slice(0, 10),
    arms: manifest.arms,
    requestedRunsPerArm: manifest.runsPerArm,
    results: await readResults(manifest.runIds, parseStoredRun),
  });
  if (manifest.error !== null)
    summary.notes.unshift(`The suite stopped early: ${manifest.error}`);
  return writeSummaries(
    summary,
    renderSummaryMarkdown(summary),
    options.publish ? path.join(summariesRoot, publishedFolder(summary)) : null
  );
}

async function main() {
  const flags = parseFlags(process.argv.slice(2), usage, ["publish"]);
  const suiteId = flags.get("suite") ?? (await latestSuiteId());
  if (suiteId === null)
    throw new Error("No stored suite. Run pnpm eval:suite first.");
  const { markdown, written } = await reportSuite(suiteId, {
    publish: flags.has("publish"),
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
