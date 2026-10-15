/**
 * Research tooling for "one Jev decision per Goal Loop step" (ayme#595). Run
 * by hand only, on the runs of the Goal Loop arms, which record each decision
 * request in `decisions.jsonl` (`decisionRecorder.ts`).
 *
 *   node src/decisionStudy.ts stages <run dir>...
 *     How many requests each step took, which stage-two questions caused the
 *     second request, and the tokens and time of each stage.
 *
 *   node src/decisionStudy.ts replay [--repeats N] <run dir>...
 *     For every recorded step that took a second request, sends to the lab
 *     app's Decision Endpoint, N times each and interleaved: the two recorded
 *     requests as they were (control), and one request that asks the stage-two
 *     questions next to the stage-one questions (combined). Writes every answer
 *     to results/decision-study/ and prints the agreement, tokens and time.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DecisionRecord } from "./decisionRecorder.ts";
import {
  decisionUsageFile,
  parseDecisionUsage,
  type DecisionUsageRecord,
} from "./goalLoop.ts";
import { formbricksRoot, labUrl, resultsRoot } from "./paths.ts";
import { decisionEndpointPath } from "./preconditions.ts";

type Json = Record<string, unknown>;
type Question = {
  type: string;
  instructions: string;
  criteria?: Record<string, string>;
};
export type DecisionRequestBody = {
  state: Json;
  questions: Record<string, Question>;
};

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Option keys that name no value: the loop's own extra choices. */
const extraKeys = new Set([
  "none_of_these",
  "leave_unset",
  "no_value_needed",
  "none",
]);

export function isStageOne(request: DecisionRequestBody): boolean {
  return "operation" in request.questions && "goal_met" in request.questions;
}

/** A recorded step: its stage-one request and the requests after it, up to the next one. */
export type RecordedStep = {
  stageOne: DecisionRecord;
  argumentRequests: DecisionRecord[];
};

const bodyOf = (record: DecisionRecord): DecisionRequestBody | null =>
  isRecord(record.request) &&
  isRecord(record.request.state) &&
  isRecord(record.request.questions)
    ? (record.request as DecisionRequestBody)
    : null;

export function stepsOf(records: readonly DecisionRecord[]): RecordedStep[] {
  const steps: RecordedStep[] = [];
  for (const record of records) {
    const body = bodyOf(record);
    if (!body) continue;
    if (isStageOne(body))
      steps.push({ stageOne: record, argumentRequests: [] });
    else steps.at(-1)?.argumentRequests.push(record);
  }
  return steps;
}

/** What a stage-two question asks for, read from its instruction as the loop words it. */
export function questionKind(id: string, question: Question): string {
  if (question.type === "noul") return "list value";
  const text = question.instructions;
  if (id.endsWith("run_off")) return "run-off";
  if (/Pick the (one )?element/.test(text)) return "element";
  if (text.startsWith("Pick the instance")) return "instance";
  if (text.startsWith("Pick the Goal Value")) return "goal value";
  if (text.startsWith("Pick the value")) return "closed value";
  return "other";
}

/** The options of a choice that name a value, the loop's extra choices left out. */
export function namedOptions(question: Question): string[] {
  return Object.keys(question.criteria ?? {}).filter(
    (key) => !extraKeys.has(key)
  );
}

/**
 * A stage-two request the loop could have skipped: every question a choice
 * with exactly one option that names a value, so a required parameter has
 * nothing to choose. (An optional one still has "leave unset", so this
 * over-counts it; the stage-two questions show which.)
 */
export function onlyOneOption(request: DecisionRequestBody): boolean {
  return Object.values(request.questions).every(
    (question) =>
      question.type === "choice" && namedOptions(question).length === 1
  );
}

const answerOf = (record: DecisionRecord | Json | null, id: string) => {
  const response =
    isRecord(record) && "response" in record ? record.response : record;
  const answers =
    isRecord(response) && isRecord(response.answers) ? response.answers : {};
  const answer = answers[id];
  if (!isRecord(answer)) return null;
  if (typeof answer.choice === "string") return answer.choice;
  if (typeof answer.noul === "number") return answer.noul;
  return null;
};

/** The input tokens the response reports, when it carries usage. */
const reportedTokens = (response: unknown): number | null => {
  if (!isRecord(response) || !isRecord(response.usage)) return null;
  const tokens = response.usage.input_tokens ?? response.usage.inputTokens;
  return typeof tokens === "number" ? tokens : null;
};

/** Input tokens per recorded request: from the response, or the usage line nearest after it was sent. */
function tokensFor(
  record: DecisionRecord,
  usage: readonly DecisionUsageRecord[]
): number | null {
  const reported = reportedTokens(record.response);
  if (reported !== null) return reported;
  const sent = Date.parse(record.time);
  const line = usage.find((each) => Date.parse(each.time) >= sent);
  return line?.usage?.inputTokens ?? null;
}

async function readRecords(runDir: string): Promise<DecisionRecord[]> {
  const text = await readFile(path.join(runDir, "decisions.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as DecisionRecord);
}

async function readUsage(): Promise<DecisionUsageRecord[]> {
  try {
    return parseDecisionUsage(
      await readFile(decisionUsageFile(formbricksRoot), "utf8")
    );
  } catch {
    return [];
  }
}

const median = (values: readonly number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const sum = (values: readonly (number | null)[]) =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0);

// --- stages ---

async function stages(runDirs: readonly string[]) {
  const usage = await readUsage();
  for (const runDir of runDirs) {
    const steps = stepsOf(await readRecords(runDir));
    console.log(`\n## ${path.basename(runDir)}: ${steps.length} steps`);
    const rows: string[] = [];
    const stageOneTokens: number[] = [];
    const stageOneMs: number[] = [];
    const stageTwoTokens: number[] = [];
    const stageTwoMs: number[] = [];
    let requests = 0;
    let twoRequestSteps = 0;
    let skippable = 0;
    for (const [index, step] of steps.entries()) {
      requests += 1 + step.argumentRequests.length;
      const one = tokensFor(step.stageOne, usage);
      if (one !== null) stageOneTokens.push(one);
      stageOneMs.push(step.stageOne.durationMs);
      const operation = answerOf(step.stageOne, "operation");
      const goalMet = answerOf(step.stageOne, "goal_met");
      const speculative = Object.keys(bodyOf(step.stageOne)!.questions).filter(
        (id) => id.startsWith("value:")
      ).length;
      const kinds: string[] = [];
      for (const record of step.argumentRequests) {
        const body = bodyOf(record)!;
        const tokens = tokensFor(record, usage);
        if (tokens !== null) stageTwoTokens.push(tokens);
        stageTwoMs.push(record.durationMs);
        for (const [id, question] of Object.entries(body.questions))
          kinds.push(
            `${questionKind(id, question)} (${namedOptions(question).length})`
          );
        if (onlyOneOption(body)) skippable += 1;
      }
      if (step.argumentRequests.length > 0) twoRequestSteps += 1;
      rows.push(
        `| ${index + 1} | ${String(operation)} | ${typeof goalMet === "number" ? goalMet.toFixed(2) : "-"} | ${speculative} | ${1 + step.argumentRequests.length} | ${kinds.join(", ") || "-"} | ${one ?? "-"} / ${sum(step.argumentRequests.map((record) => tokensFor(record, usage))) || "-"} | ${step.stageOne.durationMs} / ${sum(step.argumentRequests.map((record) => record.durationMs)) || "-"} |`
      );
    }
    console.log(
      "| Step | Operation | goal_met | Speculative questions | Requests | Stage-two questions (named options) | Input tokens, one / two | ms, one / two |"
    );
    console.log("|---|---|---|---|---|---|---|---|");
    for (const row of rows) console.log(row);
    console.log(
      `\nRequests: ${requests}. Steps with a second request: ${twoRequestSteps}, of them with one option per question: ${skippable}. Median input tokens: stage one ${median(stageOneTokens) ?? "-"}, stage two ${median(stageTwoTokens) ?? "-"}. Median ms: stage one ${median(stageOneMs) ?? "-"}, stage two ${median(stageTwoMs) ?? "-"}.`
    );
  }
}

// --- replay ---

/** Prefix of a stage-two question's id in the combined request. */
const combinedPrefix = "args:";

/**
 * The stage-one request with the chosen operation's stage-two questions next
 * to its own, as one request would ask them before the operation is known: an
 * element question no longer names the value stage one chose, and each says
 * which operation it is for. A stage-two request that only picks an element
 * sends the candidates as `elements`; they join the stage-one state.
 */
export function combinedRequest(
  stageOne: DecisionRequestBody,
  stageTwo: DecisionRequestBody,
  operation: string
): DecisionRequestBody {
  const questions: Record<string, Question> = { ...stageOne.questions };
  for (const [id, question] of Object.entries(stageTwo.questions)) {
    const instructions = question.instructions.replace(
      /Pick the (one )?element that should receive .*?, as this operation's (.*?) parameter\./,
      "Pick the $1element this operation acts on as its $2 parameter."
    );
    questions[`${combinedPrefix}${id}`] = {
      ...question,
      instructions: `If the next operation is "${operation}", answer this question for it; otherwise answer as if it were. ${instructions}`,
    };
  }
  const elements = stageTwo.state.elements;
  return {
    state:
      elements === undefined ? stageOne.state : { ...stageOne.state, elements },
    questions,
  };
}

type Sent = {
  ms: number;
  status: number;
  tokens: number | null;
  response: unknown;
};

async function send(body: DecisionRequestBody): Promise<Sent> {
  const time = new Date().toISOString();
  const started = Date.now();
  const response = await fetch(`${labUrl}${decisionEndpointPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const ms = Date.now() - started;
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // kept as text
  }
  let tokens = reportedTokens(parsed);
  if (tokens === null) {
    const line = (await readUsage()).find(
      (each) => Date.parse(each.time) >= Date.parse(time)
    );
    tokens = line?.usage?.inputTokens ?? null;
  }
  return { ms, status: response.status, tokens, response: parsed };
}

async function replay(runDirs: readonly string[], repeats: number) {
  const out: Json[] = [];
  const summary = {
    steps: 0,
    operationSame: 0,
    operationTrials: 0,
    argumentSameAsControl: 0,
    argumentSameAsRecorded: 0,
    controlSameAsRecorded: 0,
    argumentTrials: 0,
    controlTokens: [] as number[],
    combinedTokens: [] as number[],
    controlMs: [] as number[],
    combinedMs: [] as number[],
  };
  for (const runDir of runDirs) {
    const steps = stepsOf(await readRecords(runDir));
    for (const [index, step] of steps.entries()) {
      const stageTwoRecord = step.argumentRequests[0];
      if (!stageTwoRecord) continue;
      const stageOne = bodyOf(step.stageOne)!;
      const stageTwo = bodyOf(stageTwoRecord)!;
      const operation = String(answerOf(step.stageOne, "operation"));
      const combined = combinedRequest(stageOne, stageTwo, operation);
      summary.steps += 1;
      for (let trial = 1; trial <= repeats; trial++) {
        const controlOne = await send(stageOne);
        const controlTwo = await send(stageTwo);
        const together = await send(combined);
        const trialRecord: Json = {
          run: path.basename(runDir),
          step: index + 1,
          trial,
          operation: {
            recorded: operation,
            control: answerOf(controlOne.response as Json, "operation"),
            combined: answerOf(together.response as Json, "operation"),
          },
          goalMet: {
            recorded: answerOf(step.stageOne, "goal_met"),
            control: answerOf(controlOne.response as Json, "goal_met"),
            combined: answerOf(together.response as Json, "goal_met"),
          },
          arguments: Object.fromEntries(
            Object.keys(stageTwo.questions).map((id) => [
              id,
              {
                recorded: answerOf(stageTwoRecord, id),
                control: answerOf(controlTwo.response as Json, id),
                combined: answerOf(
                  together.response as Json,
                  `${combinedPrefix}${id}`
                ),
              },
            ])
          ),
          control: {
            ms: controlOne.ms + controlTwo.ms,
            tokens:
              controlOne.tokens === null || controlTwo.tokens === null
                ? null
                : controlOne.tokens + controlTwo.tokens,
            status: [controlOne.status, controlTwo.status],
          },
          combined: {
            ms: together.ms,
            tokens: together.tokens,
            status: together.status,
          },
          combinedResponse: together.response,
        };
        out.push(trialRecord);
        const ops = trialRecord.operation as Json;
        summary.operationTrials += 1;
        if (ops.combined === ops.control) summary.operationSame += 1;
        for (const answers of Object.values(
          trialRecord.arguments as Record<string, Json>
        )) {
          summary.argumentTrials += 1;
          if (answers.combined === answers.control)
            summary.argumentSameAsControl += 1;
          if (answers.combined === answers.recorded)
            summary.argumentSameAsRecorded += 1;
          if (answers.control === answers.recorded)
            summary.controlSameAsRecorded += 1;
        }
        const control = trialRecord.control as {
          ms: number;
          tokens: number | null;
        };
        const one = trialRecord.combined as {
          ms: number;
          tokens: number | null;
        };
        summary.controlMs.push(control.ms);
        summary.combinedMs.push(one.ms);
        if (control.tokens !== null) summary.controlTokens.push(control.tokens);
        if (one.tokens !== null) summary.combinedTokens.push(one.tokens);
        console.log(
          `${path.basename(runDir)} step ${index + 1} trial ${trial}: operation ${String(ops.control)} / ${String(ops.combined)}; arguments ${JSON.stringify(trialRecord.arguments)}; ms ${control.ms} / ${one.ms}; tokens ${control.tokens ?? "-"} / ${one.tokens ?? "-"}`
        );
      }
    }
  }
  const dir = path.join(resultsRoot, "decision-study");
  await mkdir(dir, { recursive: true });
  const file = path.join(
    dir,
    `replay-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  await writeFile(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(
    `\nSteps replayed: ${summary.steps}, ${repeats} trials each. Written to ${file}.`
  );
  console.log(
    `Operation, combined same as control: ${summary.operationSame} of ${summary.operationTrials}.`
  );
  console.log(
    `Arguments: combined same as control ${summary.argumentSameAsControl} of ${summary.argumentTrials}; combined same as recorded ${summary.argumentSameAsRecorded}; control same as recorded ${summary.controlSameAsRecorded}.`
  );
  console.log(
    `Median input tokens, two requests / one: ${median(summary.controlTokens) ?? "-"} / ${median(summary.combinedTokens) ?? "-"}. Median ms: ${median(summary.controlMs) ?? "-"} / ${median(summary.combinedMs) ?? "-"}.`
  );
}

// --- CLI ---

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  let repeats = 3;
  const dirs: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--repeats") repeats = Number(rest[++i]);
    else dirs.push(path.resolve(rest[i]!));
  }
  if ((command !== "stages" && command !== "replay") || dirs.length === 0) {
    console.error(
      "Usage: node src/decisionStudy.ts stages|replay [--repeats N] <run dir>..."
    );
    process.exit(1);
  }
  await (command === "stages" ? stages(dirs) : replay(dirs, repeats));
}
