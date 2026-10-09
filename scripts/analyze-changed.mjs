/**
 * Scores what a change touched: CRAP for the touched functions and Stryker
 * mutants on the changed lines, in the packages that own the changed source.
 *
 *   pnpm analyze:changed                  compare the working tree with main
 *   pnpm analyze:changed --base <ref>     compare with another ref
 *   pnpm analyze:changed --skip-mutation  CRAP only
 *
 * The report prints and is written to `reports/analyze-changed.md`. What an
 * agent does with it is in docs/testing.md#change-analysis.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Linter } from "eslint";
import { builtinRules } from "eslint/use-at-your-own-risk";
import tseslint from "typescript-eslint";

/** Functions above this CRAP score are flagged. */
export const CRAP_CAP = 15;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, "reports", "analyze-changed.md");
const SOURCE = /^(packages\/[^/]+)\/(src\/.+\.tsx?)$/;
const NOT_PRODUCTION =
  /(\.d\.ts|\.(test|testSupport|scenario|setup)\.tsx?)$|\/(test-utils|testing|__tests__|fixtures)\/|\/testing\.ts$/;

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function parseArgs(argv) {
  const args = { base: undefined, mutation: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--base") args.base = argv[(i += 1)];
    else if (argv[i] === "--skip-mutation") args.mutation = false;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

/**
 * Changed production source, compared with `base`, as a map from repository
 * path to the set of changed line numbers. Uncommitted and untracked files
 * count.
 */
export function changedLines(diff, untracked = []) {
  const changes = new Map();
  let file;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? undefined : line.slice(6);
      continue;
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || !file) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (!changes.has(file)) changes.set(file, new Set());
    // A hunk that only deletes lines touches the line it deleted after.
    if (count === 0) changes.get(file).add(Math.max(start, 1));
    for (let n = start; n < start + count; n += 1) changes.get(file).add(n);
  }
  for (const [file, lineCount] of untracked) {
    changes.set(
      file,
      new Set(Array.from({ length: lineCount }, (_, i) => i + 1))
    );
  }
  for (const file of changes.keys()) {
    if (!SOURCE.test(file) || NOT_PRODUCTION.test(file)) changes.delete(file);
  }
  return changes;
}

/** A function's name as written: its own, its variable's, or its key's. */
function nameOf(node) {
  if (node.id?.name) return node.id.name;
  const parent = node.parent;
  if (parent?.type === "VariableDeclarator") return parent.id.name;
  if (parent?.key) return parent.key.name ?? String(parent.key.value);
  return "(anonymous)";
}

/**
 * ESLint's own `complexity` rule, reporting every function with its node, so
 * the report has the function's full line range rather than its head.
 */
const complexityRule = {
  ...builtinRules.get("complexity"),
  create(context) {
    const report = (descriptor) =>
      context.report({
        loc: descriptor.node.loc,
        message: JSON.stringify({
          name: nameOf(descriptor.node),
          complexity: descriptor.data.complexity,
        }),
      });
    return builtinRules
      .get("complexity")
      .create(Object.create(context, { report: { value: report } }));
  },
};

const linter = new Linter({ configType: "flat" });
const complexityConfig = [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { analysis: { rules: { complexity: complexityRule } } },
    rules: { "analysis/complexity": ["error", 0] },
  },
];

/** Every function in `source` with its cyclomatic complexity and lines. */
export function functionsIn(source, filename) {
  return linter
    .verify(source, complexityConfig, { filename })
    .filter((message) => message.ruleId === "analysis/complexity")
    .map((message) => ({
      ...JSON.parse(message.message),
      start: message.line,
      end: message.endLine,
    }));
}

/** Share of the statements between `start` and `end` that ran, from 0 to 1. */
export function statementCoverage(fileCoverage, start, end) {
  let total = 0;
  let covered = 0;
  for (const [id, location] of Object.entries(
    fileCoverage?.statementMap ?? {}
  )) {
    if (location.start.line < start || location.end.line > end) continue;
    total += 1;
    if (fileCoverage.s[id] > 0) covered += 1;
  }
  return total === 0 ? (fileCoverage ? 1 : 0) : covered / total;
}

export function crap(complexity, coverage) {
  return complexity ** 2 * (1 - coverage) ** 3 + complexity;
}

/**
 * Whether the change made a function worse: `new` when it did not exist on
 * the base, `raised` when its complexity grew, `existing` otherwise. Functions
 * are matched by name and order, so an anonymous callback that moved can be
 * misread; the report says this is inferred.
 */
export function classify(fn, index, baseFunctions) {
  const sameName = baseFunctions.filter((base) => base.name === fn.name);
  const base =
    sameName[index] ?? (sameName.length === 1 ? sameName[0] : undefined);
  if (!base) return "new";
  return fn.complexity > base.complexity ? "raised" : "existing";
}

/**
 * A file's entry in a coverage report. Turbo can restore a report from another
 * checkout, whose keys are that checkout's absolute paths.
 */
export function coverageOf(coverage, file) {
  return (
    coverage[path.join(ROOT, file)] ??
    Object.entries(coverage).find(([key]) => key.endsWith(`/${file}`))?.[1]
  );
}

function packageOf(dir) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, dir, "package.json"), "utf8")
  );
  return manifest.scripts?.["test:crap"] ? manifest.name : undefined;
}

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function crapFindings(file, lines, base, coverage) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  let baseSource = "";
  try {
    baseSource = git("show", `${base}:${file}`);
  } catch {
    // The file is new.
  }
  const baseFunctions = baseSource ? functionsIn(baseSource, file) : [];
  const seen = new Map();
  const findings = [];
  for (const fn of functionsIn(source, file)) {
    const index = seen.get(fn.name) ?? 0;
    seen.set(fn.name, index + 1);
    const touched = [...lines].some((n) => n >= fn.start && n <= fn.end);
    if (!touched) continue;
    const covered = statementCoverage(coverage, fn.start, fn.end);
    const score = crap(fn.complexity, covered);
    if (score <= CRAP_CAP) continue;
    findings.push({
      file,
      ...fn,
      coverage: covered,
      crap: score,
      change: classify(fn, index, baseFunctions),
    });
  }
  return findings;
}

/** `src/a.ts:3-5`-style targets, one per run of consecutive changed lines. */
export function mutateTargets(packageDir, files) {
  const targets = [];
  for (const [file, lines] of files) {
    const relative = path.relative(packageDir, file);
    const sorted = [...lines].sort((a, b) => a - b);
    let start = sorted[0];
    for (let i = 1; i <= sorted.length; i += 1) {
      if (sorted[i] === sorted[i - 1] + 1) continue;
      targets.push(`${relative}:${start}-${sorted[i - 1]}`);
      start = sorted[i];
    }
  }
  return targets;
}

function survivors(packageDir, files) {
  const report = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, packageDir, "reports/mutation/mutation.json"),
      "utf8"
    )
  );
  const found = [];
  for (const [file, result] of Object.entries(report.files)) {
    const repoPath = path.join(packageDir, file);
    const lines = files.get(repoPath);
    if (!lines) continue;
    for (const mutant of result.mutants) {
      if (mutant.status !== "Survived" && mutant.status !== "NoCoverage")
        continue;
      if (!lines.has(mutant.location.start.line)) continue;
      found.push({
        file: repoPath,
        line: mutant.location.start.line,
        status: mutant.status,
        mutator: mutant.mutatorName,
        replacement: mutant.replacement,
      });
    }
  }
  return found;
}

function render({ base, packages, skipped, crapRows, mutantRows, mutation }) {
  const out = [`# Change analysis against ${base}`, ""];
  out.push(`Packages: ${packages.join(", ") || "none"}`, "");
  if (skipped.length > 0) {
    out.push(
      `Not analyzed, no \`test:crap\` script: ${skipped.join(", ")}`,
      ""
    );
  }
  out.push(`## Touched functions above CRAP ${CRAP_CAP}`, "");
  if (crapRows.length === 0) out.push("None.");
  for (const row of crapRows) {
    out.push(
      `- ${row.change} · ${row.file}:${row.start} ${row.name}: CRAP ${row.crap.toFixed(1)}, complexity ${row.complexity}, coverage ${Math.round(row.coverage * 100)}%`
    );
  }
  out.push(
    "",
    "`new` and `raised` are must-fix; `existing` is not yours to refactor. Matching to the base is by function name and order, so check a surprising label.",
    "",
    "## Surviving mutants on changed lines",
    ""
  );
  if (!mutation) out.push("Skipped.");
  else if (mutantRows.length === 0) out.push("None.");
  for (const row of mutantRows) {
    out.push(
      `- ${row.file}:${row.line} ${row.status} ${row.mutator}: \`${row.replacement}\``
    );
  }
  return `${out.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base ?? git("merge-base", "origin/main", "HEAD").trim();
  const untracked = git("ls-files", "--others", "--exclude-standard")
    .split("\n")
    .filter((file) => SOURCE.test(file))
    .map((file) => [
      file,
      fs.readFileSync(path.join(ROOT, file), "utf8").split("\n").length,
    ]);
  const changes = changedLines(
    git("diff", "-U0", base, "--", "packages"),
    untracked
  );

  const byPackage = new Map();
  const skipped = new Set();
  for (const [file, lines] of changes) {
    const dir = SOURCE.exec(file)[1];
    const name = packageOf(dir);
    if (!name) {
      skipped.add(dir);
      continue;
    }
    if (!byPackage.has(dir)) byPackage.set(dir, { name, files: new Map() });
    byPackage.get(dir).files.set(file, lines);
  }
  const packages = [...byPackage.values()].map(({ name }) => name);

  const crapRows = [];
  const mutantRows = [];
  if (packages.length > 0) {
    run("pnpm", [
      "exec",
      "turbo",
      "run",
      "test:crap",
      "--concurrency=1",
      "--output-logs=errors-only",
      ...packages.map((name) => `--filter=${name}`),
    ]);
  }
  for (const [dir, { files }] of byPackage) {
    const coverage = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, dir, "coverage/crap/coverage-final.json"),
        "utf8"
      )
    );
    for (const [file, lines] of files) {
      crapRows.push(
        ...crapFindings(file, lines, base, coverageOf(coverage, file))
      );
    }
    if (args.mutation) {
      run(
        "pnpm",
        [
          "exec",
          "stryker",
          "run",
          "--mutate",
          mutateTargets(dir, files).join(","),
        ],
        path.join(ROOT, dir)
      );
      mutantRows.push(...survivors(dir, files));
    }
  }

  const report = render({
    base,
    packages,
    skipped: [...skipped],
    crapRows: crapRows.sort((a, b) => b.crap - a.crap),
    mutantRows: mutantRows.sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line
    ),
    mutation: args.mutation,
  });
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, report);
  process.stdout.write(`\n${report}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
