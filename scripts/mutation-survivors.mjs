/**
 * Lists the mutants that survived the weekly full Stryker lane, for the job
 * summary, so the list can be read without downloading the report artifact.
 *
 *   node scripts/mutation-survivors.mjs
 *
 * Reads every `packages/*\/reports/mutation/mutation-full.json` present.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHORT = 60;
// GitHub drops a job summary over 1 MiB whole, so long lists are cut.
const MAX_LINES = 3000;

/** One summary line per Survived or NoCoverage mutant in a Stryker report. */
export function survivorLines(packageDir, report) {
  const lines = [];
  for (const [file, result] of Object.entries(report.files)) {
    for (const mutant of result.mutants) {
      if (mutant.status !== "Survived" && mutant.status !== "NoCoverage")
        continue;
      const { replacement = "" } = mutant;
      const shown =
        replacement.length <= SHORT && !replacement.includes("\n")
          ? `: \`${replacement}\``
          : "";
      lines.push(
        `- ${path.join(packageDir, file)}:${mutant.location.start.line} ${mutant.status}${mutant.static ? " static" : ""} ${mutant.mutatorName}${shown}`
      );
    }
  }
  return lines;
}

function main() {
  const out = ["# Surviving mutants", ""];
  for (const dir of fs.readdirSync(path.join(ROOT, "packages"))) {
    const packageDir = path.join("packages", dir);
    const file = path.join(
      ROOT,
      packageDir,
      "reports/mutation/mutation-full.json"
    );
    if (!fs.existsSync(file)) continue;
    const lines = survivorLines(
      packageDir,
      JSON.parse(fs.readFileSync(file, "utf8"))
    );
    out.push(
      `## ${packageDir}: ${lines.length}`,
      "",
      ...lines.slice(0, MAX_LINES),
      ...(lines.length > MAX_LINES
        ? [`- ${lines.length - MAX_LINES} more in the report artifact`]
        : []),
      ""
    );
  }
  if (out.length === 2) out.push("No mutation report found.", "");
  process.stdout.write(out.join("\n"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
