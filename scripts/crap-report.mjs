/**
 * Scores every function in the packages that ran their fast lane with
 * coverage (`turbo run test:crap`), for the weekly analysis job.
 *
 *   node scripts/crap-report.mjs
 *
 * Writes `reports/crap/crap-report.json` with every function and
 * `reports/crap/summary.md` with the ones above the cap.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CRAP_CAP,
  crap,
  functionsIn,
  statementCoverage,
} from "./analyze-changed.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "reports", "crap");

/**
 * Every function in a package's coverage report, scored from the source under
 * `root`. Turbo can restore a report from another checkout, whose keys are
 * that checkout's absolute paths, so each key is read from `packages/<dir>/`
 * on.
 */
export function scorePackage(dir, coverage, root = ROOT) {
  const marker = `/packages/${dir}/`;
  const functions = [];
  for (const [key, fileCoverage] of Object.entries(coverage)) {
    const file = key.slice(key.lastIndexOf(marker) + 1);
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const fn of functionsIn(source, file)) {
      const covered = statementCoverage(fileCoverage, fn.start, fn.end);
      functions.push({
        file,
        ...fn,
        coverage: covered,
        crap: crap(fn.complexity, covered),
      });
    }
  }
  return functions;
}

function main() {
  const functions = [];
  for (const dir of fs.readdirSync(path.join(ROOT, "packages"))) {
    const file = path.join(
      ROOT,
      "packages",
      dir,
      "coverage/crap/coverage-final.json"
    );
    if (!fs.existsSync(file)) continue;
    const coverage = JSON.parse(fs.readFileSync(file, "utf8"));
    functions.push(...scorePackage(dir, coverage));
  }
  functions.sort((a, b) => b.crap - a.crap);

  const above = functions.filter((fn) => fn.crap > CRAP_CAP);
  const summary = [
    "# CRAP report",
    "",
    `${above.length} of ${functions.length} functions are above CRAP ${CRAP_CAP}.`,
    "",
    ...above.map(
      (fn) =>
        `- ${fn.file}:${fn.start} ${fn.name}: CRAP ${fn.crap.toFixed(1)}, complexity ${fn.complexity}, coverage ${Math.round(fn.coverage * 100)}%`
    ),
    "",
  ].join("\n");

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "crap-report.json"),
    JSON.stringify(functions, null, 2)
  );
  fs.writeFileSync(path.join(OUT, "summary.md"), summary);
  process.stdout.write(summary);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
