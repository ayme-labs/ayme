/**
 * Rebuilds a suite's summary from its stored runs. Launches no agent and
 * needs neither the lab app nor a token.
 *
 *   node src/report.ts [--suite <id>] [--publish]
 *
 * The summary lands in the suite's own folder under the ignored `results/`.
 * `--publish` also writes it to `summaries/<date>/`, which is meant to be
 * committed. Transcripts and run folders are never copied.
 */
import path from "node:path";

import { parseFlags } from "./cli.ts";
import { summariesRoot } from "./paths.ts";
import {
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

/** Builds the summary from the suite's stored runs and writes it beside the manifest. */
export async function reportSuite(
  suiteId: string,
  options: { publish: boolean }
): Promise<{ summary: SuiteSummary; written: string[] }> {
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
    const published = path.join(summariesRoot, summary.date);
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
