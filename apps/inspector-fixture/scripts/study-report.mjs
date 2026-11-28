// What a study run's e2e report.json may contribute to a baseline, and the
// page the baselines render to. Browser-free, so a test can feed it reports.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

/**
 * Claude Code's texts for a login that cannot take another request, from
 * apps/eval-formbricks/src/transcript.ts. Unanchored here: e2e wraps them
 * ("The ACP agent session failed: Internal error: You've hit your …").
 */
const USAGE_LIMIT_TEXTS = [
  /You've hit your [^\n]*\b(?:limit|budget)\b/,
  /You've reached your [^\n]*\blimit\b/,
  /You're out of (?:extra usage|usage credits)\b/,
  /Credit balance is too low\b/,
  /Your org is out of usage\b/,
  /Your seat type doesn't include (?:extra )?usage\b/,
  /Your usage allocation has been disabled by your admin/,
  /Your group's usage limit is set to \$0/,
  /This service is disabled for your org\b/,
  /(?:Fable|Haiku|Mythos|Opus|Sonnet)(?: [^·\n]{1,40})? requires usage credits\./,
  /Your model policy only allows [^\n]*, which requires usage credits\b/,
  /API Error: Usage credits required for 1M context\b/,
];

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
    if (ts.isStringLiteralLike(v)) entries.push([p.name.getText(), v.text]);
    else if (ts.isNumericLiteral(v)) entries.push([p.name.getText(), +v.text]);
    else return null;
  }
  return `${text} ${JSON.stringify(Object.fromEntries(entries.sort()))}`;
}

/** Every error text in the report, in full. */
function errorTexts(value, key = "", texts = []) {
  if (typeof value === "string") {
    if (/^(error|errors|message|detail|secondaryErrors)$/.test(key))
      texts.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) errorTexts(item, key, texts);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) errorTexts(v, k, texts);
  }
  return texts;
}

/**
 * The run in `reportPath`, projected to its totals and exceptions, or a
 * NotAResult saying why it measures nothing: a report this run did not write,
 * a run that did not complete, a run the model provider refused, or a set of
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
  const blocked = errorTexts(run).find((text) =>
    USAGE_LIMIT_TEXTS.some((pattern) => pattern.test(text))
  );
  if (blocked)
    throw new NotAResult(`the model provider refused a turn: ${blocked}`);
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
    const answered = steps.filter((s) => s.status === "passed" && calls(s) > 0);
    // A step whose model usage e2e did not record makes the sum unknown.
    const usageKnown = steps.every((s) => calls(s) === 0 || s.model);
    const sum = (pick, of = steps) =>
      usageKnown
        ? of.reduce((n, s) => n + (s.model ? pick(s.model) : 0), 0)
        : null;
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
      modelAnswered: answered.length,
      unaccounted: steps.length - replayed.length - answered.length,
      // inputTokens include prompt-cache reads and writes (@e2e-dev/acp).
      tokens: sum(tokens),
      cacheReadTokens: sum((m) => m.cacheReadTokens ?? 0),
      noEntryTokens: sum(
        tokens,
        steps.filter((s) => s.cache?.reason === "no-entry")
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
        tokens: s.model ? s.model.inputTokens + s.model.outputTokens : null,
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
  const runsOf = (a) => `${a.runs.length} runs`;
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
            range(of("modelAnswered")),
            range(of("unaccounted")),
            `${range(notReplayed.map((n) => n.steps))} (${range(notReplayed.map((n) => n.distinct))})`,
            range(of("tokens"), count),
            range(
              a.runs.map((r) => r.estimatedCostUsd),
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
  const arm2 = arms.find((a) => a.arm === "arm2");
  const attributions = goalArms
    .filter((a) => a.runs.some((r) => r.shared.noEntryTokens))
    .map(
      (a) =>
        `- ${a.name}: steps with no recording (missed, no-entry) used ${a.runs.map((r) => (r.shared.noEntryTokens === null ? "unknown" : count(r.shared.noEntryTokens))).join(", ")} tokens in its ${runsOf(a)}, ${range(
          a.runs.map((r) =>
            r.shared.tokens ? r.shared.noEntryTokens / r.shared.tokens : null
          ),
          percent
        )} of its tokens. An attribution within these runs, not an estimate of a run without those steps: they shared an agent session with the arm's other steps.`
    );
  const where = (s) => `${s.test}, line ${s.line}, "${s.step}"`;
  // A step every run found no recording for: not a hand-off but a gap in
  // the recordings, which reaches the model on every run.
  const unrecorded = (a) =>
    new Set(
      a.runs
        .map(
          (r) =>
            new Set(
              r.notReplayed.filter((s) => s.reason === "no-entry").map(where)
            )
        )
        .reduce((x, y) => new Set([...x].filter((k) => y.has(k))))
    );
  const listed = (a, keep) => {
    const seen = new Map();
    a.runs.forEach((r, i) => {
      for (const s of r.notReplayed.filter(keep)) {
        const why = [
          s.cache ?? "no cache",
          s.reason,
          s.detail,
          s.status !== "passed" && `step ${s.status}`,
        ]
          .filter(Boolean)
          .join(", ");
        const key = `${where(s)}: ${why}`;
        seen.set(key, [
          ...(seen.get(key) ?? []),
          `run ${i + 1} (${s.tokens === null ? "usage unknown" : `${count(s.tokens)} tokens`})`,
        ]);
      }
    });
    const lines = [...seen].map(
      ([key, runs]) => `- ${key}. ${runs.join(", ")}.`
    );
    return `${a.name}:\n\n${lines.join("\n") || "- none"}`;
  };
  const failures = arms.flatMap((a) =>
    a.runs.flatMap((r, i) =>
      r.failedTests.map(
        (f) => `- ${a.name}, run ${i + 1}: ${f.test} ${f.status}: ${f.error}`
      )
    )
  );
  const cohort = current?.cohort;

  return `# Page Object study: baselines

The "before" of the Page Object study (the [fixture's README](../../README.md)): each arm's suite on the Inspector before the redesign. Each cell is the range over the arm's runs; each run's totals and exceptions are in \`<arm>.json\`.

${cohort ? `The suite: ${cohort.shared} test runs that every arm has, and ${cohort.others} more of arm 2's own, ${cohort.shared + cohort.others} in arm 2.` : "No arm is measured yet."}
${stale.length ? `\nMeasured on other tests, so not shown until they are measured again: ${stale.map((a) => a.name).join(", ")}.\n` : ""}
## Measuring an arm

\`\`\`sh
pnpm study:baseline arm1
pnpm study:baseline arm2
pnpm study:baseline arm3
pnpm study:baseline render   # this page again, from the arms' files
\`\`\`

Run it from \`apps/inspector-fixture\` in the repository's Devbox shell, on your own machine, from a committed tree, one arm at a time with nothing else running. The goal arms replay the recordings committed under \`.e2e/goals-cache\` and \`.e2e/goals-tools-cache\` read-only; a step that does not replay goes to Claude Code on the machine's own login, so it must be signed in, and the \`ayme mcp\` port the arm's recordings were made on must be free (\`e2e.goals.config.ts\`, \`e2e.goals-tools.config.ts\`). It builds the packages the fixture serves, warms one fixture server, runs the arm's own script three times on it, and saves the arm's file only when all three runs completed on one commit with the same recordings. Each run's full e2e report stays on the machine that ran it, at \`.e2e/study/<arm>/<time>/run-<n>/report.json\`, and is not published. [The script](../../scripts/study-baseline.mjs) holds each guard's reason.

## The tests every arm has

${table(
  [
    "Arm",
    "Tests passed",
    "Summed test time",
    "Goal steps",
    "Replayed, no model call",
    "Model answered",
    "Unaccounted",
    "Not replayed (distinct goals)",
    "Tokens",
    "e2e's cost estimate",
  ],
  arms.map(sharedRow)
)}

- Tokens are input plus output, prompt-cache reads and writes included; cache reads are ${range(cacheShare, percent)} of them. e2e's cost estimate is its own, from the same usage.
- Unaccounted: a goal step that neither replayed nor passed with the model, so its usage cannot be told.
- Not replayed: the goal steps that did not replay with no model call, and in brackets the distinct goals among them, a goal's text with its parameters counted once however many tests run it: the count a recording per goal, shared by every test, would have left.${perUse.length ? ` A goal whose parameters are only known at run time counts once per use, so the bracket is an upper bound for ${perUse.map((a) => a.name).join(" and ")}.` : ""}
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

Command wall time is the arm's script from start to exit, every test of the arm included. The load average is the machine's 1-minute load as each run started.

${table(
  ["Arm", "Command wall time", "Load average", "Commit", "Recordings"],
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
      ? `\`${a.recordings.dir}\`, ${a.recordings.entries ?? "?"} entries, digest \`${a.recordings.digest.slice(0, 9)}\``
      : "none",
  ])
)}
${commits.size > 1 ? "\nThe arms were measured at different commits.\n" : ""}
## Goal steps with no recording

Steps the committed recordings hold no entry for in every run (e2e's \`no-entry\`), so they reach the model each time; they count as model answered above. e2e as published records nothing for a step that changed no control and no route on the tab it reads (\`no-change\` in [When a recording is written](https://e2e.com/docs/cache#when-a-recording-is-written)).

${goalArms.map((a) => listed(a, (s) => unrecorded(a).has(where(s)))).join("\n\n")}

## Goal steps not replayed

The other goal steps that did not replay, by test and line, with e2e's reason, the runs each was in and its usage there.

${goalArms.map((a) => listed(a, (s) => !unrecorded(a).has(where(s)))).join("\n\n")}

## Tests that did not pass

${failures.join("\n") || "None."}
`;
}
