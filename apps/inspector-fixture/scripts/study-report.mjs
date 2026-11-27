// What a study run's e2e report.json may contribute to a baseline, and the
// page the baselines render to. Browser-free, so a test can feed it reports.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

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
  { startedAfter, commit, exitCode, expected, shared, clean = (s) => s }
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
    notReplayed: run.results.flatMap((r) =>
      r.attempts
        .flatMap((a) => a.steps)
        .filter(
          (s) =>
            s.kind === "agent" &&
            !(s.cache?.mode === "self-finalized" && s.metrics?.modelCalls === 0)
        )
        .map((s) => ({
          test: where(r),
          line: s.source?.line,
          step: s.label,
          status: s.status,
          cache: s.cache?.mode ?? null,
          reason: s.cache?.reason ?? null,
          detail: clean(s.cache?.detail ?? ""),
          tokens: s.model ? s.model.inputTokens + s.model.outputTokens : null,
        }))
    ),
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

/** The study README, from every measured arm's summary. */
export function render(arms) {
  const digests = new Set(arms.map((a) => a.cohort.digest));
  if (digests.size > 1)
    throw new Error(
      `the arms measured different tests: ${arms.map((a) => `${a.arm} ${a.cohort.digest.slice(0, 9)}`).join(", ")}; measure them again from one commit`
    );
  const commits = new Set(arms.map((a) => a.commit));
  const goals = (a) => a.arm !== "arm2";
  const sharedRow = (a) => {
    const t = a.runs.map((r) => r.shared);
    const of = (key) => t.map((x) => x[key]);
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
            range(of("tokens"), count),
            range(
              a.runs.map((r) => r.estimatedCostUsd),
              usd
            ),
          ]
        : ["none", "none", "none", "none", "none", "none"]),
    ];
  };
  const table = (head, rows) =>
    [
      `| ${head.join(" | ")} |`,
      `| ${head.map(() => "---").join(" | ")} |`,
      ...rows.map((r) => `| ${r.join(" | ")} |`),
    ].join("\n");
  const goalArms = arms.filter(goals);
  const cacheShare = goalArms.flatMap((a) =>
    a.runs
      .filter((r) => r.shared.tokens)
      .map((r) => r.shared.cacheReadTokens / r.shared.tokens)
  );
  const arm2 = arms.find((a) => a.arm === "arm2");
  const attributions = goalArms
    .filter((a) => a.runs.some((r) => r.shared.noEntryTokens))
    .map(
      (a) =>
        `- ${a.name}: steps with no recording (missed, no-entry) used ${a.runs.map((r) => (r.shared.noEntryTokens === null ? "unknown" : count(r.shared.noEntryTokens))).join(", ")} tokens in its three runs, ${range(
          a.runs.map((r) =>
            r.shared.tokens ? r.shared.noEntryTokens / r.shared.tokens : null
          ),
          percent
        )} of its tokens. An attribution within these runs, not an estimate of a run without those steps: they shared an agent session with the arm's other steps.`
    );
  const notReplayed = goalArms.map((a) => {
    const seen = new Map();
    a.runs.forEach((r, i) => {
      for (const s of r.notReplayed) {
        const why = [
          s.cache ?? "no cache",
          s.reason,
          s.detail,
          s.status !== "passed" && `step ${s.status}`,
        ]
          .filter(Boolean)
          .join(", ");
        const key = `${s.test}, line ${s.line}, "${s.step}": ${why}`;
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
  });
  const failures = arms.flatMap((a) =>
    a.runs.flatMap((r, i) =>
      r.failedTests.map(
        (f) => `- ${a.name}, run ${i + 1}: ${f.test} ${f.status}: ${f.error}`
      )
    )
  );

  return `# Page Object study: baselines

The "before" of the Page Object study (the [fixture's README](../../README.md)): each arm's suite on the Inspector before the redesign. Each cell is the range over the arm's three runs; each run's totals and exceptions are in \`<arm>.json\`.

## Measuring an arm

\`\`\`sh
pnpm study:baseline arm1 --cache-from <a checkout>/apps/inspector-fixture/.e2e/goals-cache
pnpm study:baseline arm2
pnpm study:baseline arm3 --cache-from <a checkout>/apps/inspector-fixture/.e2e/goals-tools-cache
pnpm study:baseline render   # this page again, from the arms' files
\`\`\`

Run it on your own machine from a committed tree, one arm at a time with nothing else running; a goal arm's hand-offs use this machine's Claude login. It builds the packages the fixture serves, warms one fixture server, runs the arm's own script three times on it, and saves the arm's file only when all three runs completed on one commit with the same recordings. The recordings are not in git (\`.e2e/\` is ignored): \`--cache-from\` copies them in and saves their digest and where they were made. Each run's full e2e report stays on the machine that ran it, at \`.e2e/study/<arm>/<time>/run-<n>/report.json\`, and is not published. [The script](../../scripts/study-baseline.mjs) holds each guard's reason.

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
    "Tokens",
    "e2e's cost estimate",
  ],
  arms.map(sharedRow)
)}

- Tokens are input plus output, prompt-cache reads and writes included; cache reads are ${range(cacheShare, percent)} of them. e2e's cost estimate is its own, from the same usage.
- Unaccounted: a goal step that neither replayed nor passed with the model, so its usage cannot be told.
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

Command wall time is the arm's script from start to exit, every test of the arm included.

${table(
  ["Arm", "Command wall time", "Commit", "Recordings", "Copied from"],
  arms.map((a) => [
    a.name,
    range(
      a.runs.map((r) => r.commandWallMs),
      seconds
    ),
    `\`${a.commit.slice(0, 9)}\``,
    a.recordings ? `\`${a.recordings.digest.slice(0, 9)}\`` : "none",
    a.recordings?.copiedFrom
      ? `${a.recordings.copiedFrom.branch} at \`${a.recordings.copiedFrom.commit.slice(0, 9)}\``
      : "none",
  ])
)}
${commits.size > 1 ? "\nThe arms were measured at different commits.\n" : ""}
## Goal steps not replayed

By test and line, with e2e's reason, the runs each was in and its usage there.

${notReplayed.join("\n\n")}

## Tests that did not pass

${failures.join("\n") || "None."}
`;
}
