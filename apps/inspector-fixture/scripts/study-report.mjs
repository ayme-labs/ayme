// What a study run's e2e report.json may contribute to a baseline, and the
// page the baselines render to. Browser-free, so a test can feed it reports.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

/** A run that measures something other than the arm: it never enters a range. */
export class NotAResult extends Error {}

/** One test instance in every arm: its file under the arm's tests folder, less the arm's suffix, its title path and its target. */
export function testKey({ file, titlePath, target }) {
  const path = file
    .replace(/^tests\/(goals\/)?/, "")
    .replace(/\.(e2e|goal)\.ts$/, "");
  return [path, ...titlePath].join(" › ") + ` [${target}]`;
}

/**
 * The tests every arm shares and arm 2's others, from `e2e list` of arm 2's
 * config and the mirror check's LEFT_OUT, which names a test or a describe
 * by its file and its own title ("<file>.e2e.ts › <title>").
 */
export function cohortOf(pairs, leftOut) {
  const shared = [];
  const extras = [];
  for (const pair of pairs) {
    const file = pair.file.replace(/^tests\//, "");
    const out = pair.titlePath.some((title) =>
      leftOut.has(`${file} › ${title}`)
    );
    (out ? extras : shared).push(testKey(pair));
  }
  const all = [...shared, ...extras];
  const twice = all.filter((key, i) => all.indexOf(key) !== i);
  if (twice.length)
    throw new Error(`test keys are not unique:\n${twice.join("\n")}`);
  return { shared: shared.sort(), extras: extras.sort() };
}

export function digestOf(keys) {
  return createHash("sha256").update(keys.join("\n")).digest("hex");
}

/**
 * Each `agent.act` call in the goal files, by `<file>:<line>` as e2e's step
 * source gives it, mapped to its goal: the text and its parameters, so two
 * tests running the same goal with the same values name one goal. e2e's
 * report keeps the text but not the parameters, so they are read from the
 * call; a call whose parameters are only known at run time maps to null.
 */
export function goalIdentities(root, dir) {
  const goals = new Map();
  for (const name of readdirSync(join(root, dir)).filter((f) =>
    f.endsWith(".goal.ts")
  )) {
    const file = `${dir}/${name}`;
    const source = ts.createSourceFile(
      file,
      readFileSync(join(root, file), "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    (function visit(node) {
      const callee = ts.isCallExpression(node) && node.expression;
      if (
        callee &&
        ts.isPropertyAccessExpression(callee) &&
        callee.expression.getText() === "agent" &&
        callee.name.text === "act" &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        // e2e's step source is the line of `act`, not of the statement.
        const { line } = source.getLineAndCharacterOfPosition(
          callee.name.getStart()
        );
        goals.set(
          `${file}:${line + 1}`,
          goalOf(node.arguments[0].text, node.arguments[1])
        );
      }
      ts.forEachChild(node, visit);
    })(source);
  }
  return goals;
}

function goalOf(text, options) {
  const params =
    options &&
    ts.isObjectLiteralExpression(options) &&
    options.properties.find((p) => p.name?.getText() === "params");
  if (!params) return text;
  const value = ts.isPropertyAssignment(params) && params.initializer;
  if (!value || !ts.isObjectLiteralExpression(value)) return null;
  const entries = [];
  for (const p of value.properties) {
    const v = ts.isPropertyAssignment(p) && p.initializer;
    if (!v) return null;
    // `lens` and `"lens"` name one property.
    const name =
      ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)
        ? p.name.text
        : null;
    if (name === null) return null;
    if (ts.isStringLiteralLike(v)) entries.push([name, v.text]);
    else if (ts.isNumericLiteral(v)) entries.push([name, +v.text]);
    else return null;
  }
  return `${text} ${JSON.stringify(Object.fromEntries(entries.sort()))}`;
}

/**
 * The modules NODE_OPTIONS preloads into every Node process a run starts. A
 * baseline arm runs e2e as published, so nothing may be preloaded into it:
 * e2e-tools' hook would patch it (packages/e2e-tools/README.md).
 */
export function preloads(nodeOptions = "") {
  return [
    ...nodeOptions.matchAll(
      /(?:^|\s)(--import|--require|-r|--loader|--experimental-loader)(?:=|\s+)(\S+)/g
    ),
  ].map((m) => `${m[1]} ${m[2]}`);
}

/** Every structured error e2e wrote in the report (its schema's `error`). */
function errorsIn(value, found = []) {
  if (Array.isArray(value)) for (const item of value) errorsIn(item, found);
  else if (value && typeof value === "object") {
    if (typeof value.category === "string" && typeof value.code === "string")
      found.push(value);
    for (const v of Object.values(value)) errorsIn(v, found);
  }
  return found;
}

/**
 * The run in `reportPath`, projected to its totals and exceptions, or a
 * NotAResult saying why it measures nothing: a report this run did not write,
 * a run that did not complete, a run with an error e2e does not class as a
 * test failure (the model provider's, the machine's, e2e's own), or a set of
 * tests other than the cohort. `expected` lists the keys the arm must run,
 * `shared` those that count in the shared row; `clean` hides local paths.
 */
export function projectRun(
  reportPath,
  {
    startedAfter,
    commit,
    exitCode,
    expected,
    shared,
    clean = (s) => s,
    goals = new Map(),
  }
) {
  // e2e leaves the last report in place when a run stops before its tests.
  if (!existsSync(reportPath))
    throw new NotAResult(`no report at ${reportPath}`);
  const { run } = JSON.parse(readFileSync(reportPath, "utf8"));
  if (!(Date.parse(run.startedAt) >= startedAfter))
    throw new NotAResult(`${reportPath} is from an earlier run`);
  // A test failure is the product's; any other category is the run's, such
  // as MODEL_PROVIDER_FAILED for an agent session that failed, a usage limit
  // included (@e2e-dev/acp).
  const notTest = errorsIn(run).find((e) => e.category !== "test");
  if (notTest)
    throw new NotAResult(
      `e2e reported a ${notTest.category} error, not a test failure: ${notTest.code}: ${clean(notTest.message ?? "").slice(0, 500)}`
    );
  // passed and failed are verdicts; blocked, error and interrupted are not.
  if (!["passed", "failed"].includes(run.status) || exitCode !== run.exitCode)
    throw new NotAResult(
      `the run did not complete: e2e's status ${run.status}, exit code ${exitCode}`
    );
  if (run.vcs?.commit !== commit)
    throw new NotAResult(`the report is of ${run.vcs?.commit}, not ${commit}`);
  const keys = run.results.map((r) => testKey({ ...r, target: r.targetId }));
  const unfinished = run.results.filter(
    (r) => !["passed", "failed", "timed-out"].includes(r.status)
  );
  const missing = expected.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !expected.includes(k));
  const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (unfinished.length || missing.length || extra.length || twice.length)
    throw new NotAResult(
      [
        ...unfinished.map(
          (r) => `not run (${r.status}): ${keys[run.results.indexOf(r)]}`
        ),
        ...missing.map((k) => `missing: ${k}`),
        ...extra.map((k) => `not in the cohort: ${k}`),
        ...twice.map((k) => `twice: ${k}`),
      ].join("\n")
    );

  const totals = (results) => {
    const steps = results.flatMap((r) =>
      r.attempts.flatMap((a) => a.steps).filter((s) => s.kind === "agent")
    );
    const calls = (s) => s.metrics?.modelCalls;
    const replayed = steps.filter(
      (s) =>
        s.status === "passed" &&
        s.cache?.mode === "self-finalized" &&
        calls(s) === 0
    );
    const reached = steps.filter((s) => calls(s) > 0);
    // e2e's step metrics count each goal step's model calls; a step without
    // them leaves the run's count unknown.
    const modelCalls = steps.every((s) => calls(s) !== undefined)
      ? steps.reduce((n, s) => n + calls(s), 0)
      : null;
    // Token counts are the provider's only: e2e writes a model record when
    // the ACP agent gave no usage too, marked adapter-upper-bound.
    const usageKnown =
      modelCalls !== null &&
      reached.every((s) => s.model?.tokenAccounting === "provider");
    const sum = (pick, of = reached) =>
      usageKnown ? of.reduce((n, s) => n + pick(s.model), 0) : null;
    const tokens = (m) => m.inputTokens + m.outputTokens;
    return {
      passed: results.filter((r) => r.status === "passed").length,
      tests: results.length,
      testMs: results.reduce(
        (n, r) => n + r.attempts.reduce((m, a) => m + a.durationMs, 0),
        0
      ),
      steps: steps.length,
      replayed: replayed.length,
      reachedModel: reached.length,
      reachedModelFailed: reached.filter((s) => s.status !== "passed").length,
      neither: steps.length - replayed.length - reached.length,
      modelCalls,
      // inputTokens include prompt-cache reads and writes (@e2e-dev/acp).
      tokens: sum(tokens),
      cacheReadTokens: sum((m) => m.cacheReadTokens ?? 0),
      noEntryTokens: sum(
        tokens,
        reached.filter((s) => s.cache?.reason === "no-entry")
      ),
    };
  };
  const notReplayed = run.results.flatMap((r) =>
    r.attempts
      .flatMap((a) => a.steps)
      .filter(
        (s) =>
          s.kind === "agent" &&
          !(s.cache?.mode === "self-finalized" && s.metrics?.modelCalls === 0)
      )
      .map((s) => ({
        test: keys[run.results.indexOf(r)],
        line: s.source?.line,
        step: s.label,
        goal: goals.get(`${s.source?.file}:${s.source?.line}`) ?? null,
        status: s.status,
        cache: s.cache?.mode ?? null,
        reason: s.cache?.reason ?? null,
        detail: clean(s.cache?.detail ?? ""),
        modelCalls: s.metrics?.modelCalls ?? null,
        tokens:
          s.model?.tokenAccounting === "provider"
            ? s.model.inputTokens + s.model.outputTokens
            : null,
      }))
  );
  // A goal whose parameters are only known at run time counts once per use,
  // so `distinct` is an upper bound by `perUse`.
  const perUse = notReplayed.filter((s) => s.goal === null).length;
  const inShared = run.results.filter((_, i) => shared.includes(keys[i]));
  const others = run.results.filter((_, i) => !shared.includes(keys[i]));
  const where = (r) => keys[run.results.indexOf(r)];
  return {
    startedAt: run.startedAt,
    status: run.status,
    shared: totals(inShared),
    ...(others.length && { others: totals(others) }),
    estimatedCostUsd: run.usage?.estimatedCostUsd ?? null,
    failedTests: run.results
      .filter((r) => r.status !== "passed")
      .map((r) => ({
        test: where(r),
        status: r.status,
        error: clean(r.attempts.at(-1)?.error?.message ?? "").slice(0, 500),
      })),
    notReplayed,
    notReplayedGoals: {
      steps: notReplayed.length,
      distinct:
        new Set(notReplayed.flatMap((s) => (s.goal === null ? [] : [s.goal])))
          .size + perUse,
      perUse,
    },
  };
}

const range = (values, format = String) => {
  const known = values.filter((v) => v !== null && v !== undefined);
  if (!known.length) return "unknown";
  const lo = format(Math.min(...known));
  const hi = format(Math.max(...known));
  const unknown = values.length - known.length;
  return (
    (lo === hi ? lo : `${lo}–${hi}`) +
    (unknown ? ` (unknown in ${unknown} runs)` : "")
  );
};
const seconds = (ms) => `${(ms / 1000).toFixed(0)} s`;
const count = (n) => n.toLocaleString("en");
const usd = (n) => `$${n.toFixed(2)}`;
const percent = (n) => `${Math.round(n * 100)}%`;

/**
 * The study README, from the measured arms' summaries. It shows the arms
 * measured on the same tests as `latest` (an arm's id, else the arm measured
 * last), and names the others as measured on other tests, so measuring one
 * arm after the suite changed renders it alone instead of failing.
 */
export function render(all, latest) {
  const newest = (a) => a.runs.at(-1)?.startedAt ?? "";
  const current =
    all.find((a) => a.arm === latest) ??
    [...all].sort((a, b) => newest(a).localeCompare(newest(b))).at(-1);
  const arms = all.filter((a) => a.cohort.digest === current?.cohort.digest);
  const stale = all.filter((a) => !arms.includes(a));
  const commits = new Set(arms.map((a) => a.commit));
  const goals = (a) => a.arm !== "arm2";
  const goalArms = arms.filter(goals);
  const arm2 = arms.find((a) => a.arm === "arm2");
  // The cohort's digest covers the shared tests only, so arm 2's own count
  // comes from arm 2's result.
  const arm2Own = arm2 && (arm2.runs[0].others?.tests ?? 0);
  const sharedRow = (a) => {
    const t = a.runs.map((r) => r.shared);
    const of = (key) => t.map((x) => x[key]);
    const notReplayed = a.runs.map((r) => r.notReplayedGoals);
    return [
      a.name,
      `${range(of("passed"))} of ${t[0].tests}`,
      range(of("testMs"), seconds),
      ...(goals(a)
        ? [
            range(of("steps")),
            range(of("replayed")),
            `${range(of("reachedModel"))} (${range(of("reachedModelFailed"))})`,
            range(of("neither")),
            `${range(notReplayed.map((n) => n.steps))} (${range(notReplayed.map((n) => n.distinct))})`,
            range(of("tokens"), count),
            // e2e leaves the estimate out of a run that called no model; the
            // step metrics say whether it did.
            range(
              a.runs.map(
                (r) =>
                  r.estimatedCostUsd ?? (r.shared.modelCalls === 0 ? 0 : null)
              ),
              usd
            ),
          ]
        : Array(7).fill("none")),
    ];
  };
  const table = (head, rows) =>
    [
      `| ${head.join(" | ")} |`,
      `| ${head.map(() => "---").join(" | ")} |`,
      ...rows.map((r) => `| ${r.join(" | ")} |`),
    ].join("\n");
  const cacheShare = goalArms.flatMap((a) =>
    a.runs
      .filter((r) => r.shared.tokens)
      .map((r) => r.shared.cacheReadTokens / r.shared.tokens)
  );
  const perUse = goalArms.filter((a) =>
    a.runs.some((r) => r.notReplayedGoals.perUse)
  );
  const attributions = goalArms
    .filter((a) => a.runs.some((r) => r.shared.noEntryTokens))
    .map(
      (a) =>
        `- ${a.name}: steps with no recording (no-entry) used ${a.runs.map((r) => (r.shared.noEntryTokens === null ? "unknown" : count(r.shared.noEntryTokens))).join(", ")} tokens in its ${a.runs.length} runs, ${range(
          a.runs.map((r) =>
            r.shared.tokens ? r.shared.noEntryTokens / r.shared.tokens : null
          ),
          percent
        )} of its tokens. An attribution within these runs, not an estimate of a run without those steps: they shared an agent session with the arm's other steps.`
    );
  const exceptions = goalArms.map((a) => {
    const seen = new Map();
    a.runs.forEach((r, i) => {
      for (const s of r.notReplayed) {
        const what = [
          s.cache ?? "no cache",
          s.reason,
          s.detail,
          `step ${s.status}`,
        ]
          .filter(Boolean)
          .join(", ");
        const key = `${s.test}, line ${s.line}, "${s.step}": ${what}`;
        const usage =
          s.modelCalls === 0
            ? "no model call"
            : s.tokens === null
              ? "tokens unknown"
              : `${count(s.tokens)} tokens`;
        seen.set(key, [...(seen.get(key) ?? []), `run ${i + 1} (${usage})`]);
      }
    });
    const lines = [...seen].map(
      ([key, runs]) => `- ${key}. ${runs.join(", ")}.`
    );
    return `${a.name}:\n\n${lines.join("\n") || "- none"}`;
  });
  const failures = arms.flatMap((a) =>
    a.runs.flatMap((r, i) =>
      r.failedTests.map(
        (f) => `- ${a.name}, run ${i + 1}: ${f.test} ${f.status}: ${f.error}`
      )
    )
  );
  const shared = current?.cohort.shared;

  return `# Page Object study: baselines

The "before" of the Page Object study (the [fixture's README](../../README.md)): each arm's suite on the Inspector before the redesign. Each cell is the range over the arm's runs; each run's totals and exceptions are in \`<arm>.json\`.

${current ? `The suite: ${shared} test runs that every arm has${arm2Own === undefined ? "" : `, and ${arm2Own} more of arm 2's own, ${shared + arm2Own} in arm 2`}.` : "No arm is measured yet."}
${stale.length ? `\nMeasured on other tests, so not shown until they are measured again: ${stale.map((a) => a.name).join(", ")}.\n` : ""}
## Measuring an arm

\`\`\`sh
pnpm study:baseline arm1
pnpm study:baseline arm2
pnpm study:baseline arm3
pnpm study:baseline render   # this page again, from the arms' files
\`\`\`

Run it from \`apps/inspector-fixture\` in the repository's Devbox shell, on your own machine, from a committed tree, one arm at a time with nothing else running. The goal arms replay the recordings committed under \`.e2e/goals-cache\` and \`.e2e/goals-tools-cache\` read-only; a step that does not replay goes to Claude Code on the machine's own login, so it must be signed in, and the \`ayme mcp\` port the arm's recordings were made on must be free ([e2e.goals.config.ts](../../e2e.goals.config.ts), [e2e.goals-tools.config.ts](../../e2e.goals-tools.config.ts)). It builds the packages the fixture serves, warms one fixture server, runs the arm's own script three times on it, and saves the arm's file only when all three runs completed on one commit with the same recordings. Each run's full e2e report stays on the machine that ran it, at \`.e2e/study/<arm>/<time>/run-<n>/report.json\`, and is not published. [The script](../../scripts/study-baseline.mjs) holds each guard's reason.

## The tests every arm has

${table(
  [
    "Arm",
    "Tests passed",
    "Summed test time",
    "Goal steps",
    "Replayed, no model call",
    "Reached the model (failed)",
    "Neither",
    "Not replayed (distinct goals)",
    "Tokens",
    "e2e's cost estimate",
  ],
  arms.map(sharedRow)
)}

- Reached the model: a goal step e2e's step metrics count a model call for, whatever its outcome; in brackets those whose step failed. Neither: a goal step that did not replay and called no model, such as one that failed before a call.
- Tokens are the provider's input plus output, prompt-cache reads and writes included${cacheShare.length ? `; cache reads are ${range(cacheShare, percent)} of them` : ""}. They are unknown for a run in which a step that reached the model has no provider count (e2e marks such a record \`adapter-upper-bound\`). e2e's cost estimate is its own; $0.00 where no step called a model.
- Not replayed: the goal steps of these runs that did not replay with no model call, and in brackets the distinct goals among them, a goal's text with its parameters counted once however many tests ran it.${perUse.length ? ` A goal whose parameters are only known at run time counts once per use, so the bracket is an upper bound for ${perUse.map((a) => a.name).join(" and ")}.` : ""}
- Every arm ran with one worker and no retries, so this is a serial comparison. The default test timeout is 30 s in arm 2 and 900 s in the goal arms ([e2e.config.ts](../../e2e.config.ts), [e2e.goals.config.ts](../../e2e.goals.config.ts)).
${attributions.length ? `\n${attributions.join("\n")}\n` : ""}
## Arm 2's other tests

The tests with no action to turn into a goal (\`LEFT_OUT\` in [the mirror check](../../scripts/check-goal-mirror.mjs)).

${
  arm2?.runs[0].others
    ? table(
        ["Arm", "Tests passed", "Summed test time"],
        [
          [
            arm2.name,
            `${range(arm2.runs.map((r) => r.others.passed))} of ${arm2.runs[0].others.tests}`,
            range(
              arm2.runs.map((r) => r.others.testMs),
              seconds
            ),
          ],
        ]
      )
    : "Not measured yet."
}

## Whole runs

Command time is the arm's script from start to exit, every test of the arm included. The load average is the machine's 1-minute load as each run started.

${table(
  ["Arm", "Command time", "Load average", "Commit", "Recordings"],
  arms.map((a) => [
    a.name,
    range(
      a.runs.map((r) => r.commandWallMs),
      seconds
    ),
    range(
      a.runs.map((r) => r.loadAverage?.[0]),
      (n) => n.toFixed(1)
    ),
    `\`${a.commit.slice(0, 9)}\``,
    a.recordings
      ? `\`${a.recordings.dir}\`, ${a.recordings.entries} entries, digest \`${a.recordings.digest.slice(0, 9)}\``
      : "none",
  ])
)}
${commits.size > 1 ? "\nThe arms were measured at different commits.\n" : ""}
## Goal steps that did not replay

By test and line: e2e's cache outcome and reason (\`no-entry\`: the recordings hold none for the step; e2e records nothing for a step that changed no control and no route, \`no-change\` in [When a recording is written](https://e2e.com/docs/cache#when-a-recording-is-written)), the step's outcome, and the runs it was in with their usage.

${exceptions.join("\n\n")}

## Tests that did not pass

${failures.join("\n") || "None."}
`;
}
