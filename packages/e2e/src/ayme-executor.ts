/**
 * An e2e step executor that answers page object steps from the store first.
 *
 * e2e replays recorded clicks itself (`cache: 'inherit'`) and hands a step
 * to the executor on a miss, or at a gap: stock e2e records every page
 * object call as a gap. Here, such a step is looked up in the page object
 * call store (`store.ts`): on a hit its calls run again, each bounded to
 * `REPLAY_TIMEOUT_MS`, and the step passes with no model; the method's own
 * waits and the test's next check verify it. On a miss, or when a stored
 * call fails, the solver (an agent session over ACP, or a scripted stand-in)
 * runs the step and reports what it did; a passing step that ended in page
 * object calls is stored, and one that passed around a failed stored call
 * keeps the entry and leaves a repair proposal.
 */

import { appendFileSync } from "node:fs";
import type {
  JsonValue,
  StepExecutor,
  StepExecutorContext,
  StepVerdict,
} from "e2e";
import { executePageObjectTool, type PageObjectTools } from "./ayme-tools.ts";
import { describeAction, type NodeTarget } from "./describe.ts";
import {
  fillArgs,
  PageObjectStore,
  type StepAction,
  type StoreHit,
} from "./store.ts";

/** How long a stored page object call has: it works as recorded, or the page object needs fixing. */
const REPLAY_TIMEOUT_MS = 5_000;

/** What a solver gets for one step beyond e2e's context. */
export interface SolveStep {
  readonly ctx: StepExecutorContext;
  /** Set when a stored call for this step just failed: what to tell the solver so it does not repeat it. */
  readonly note?: string;
  readonly tools: PageObjectTools;
  /** Calls a page object tool under e2e's accounting, recording it as this step's action. */
  callTool(tool: string, args: JsonValue): Promise<unknown>;
  /** The page object tools live on the page when the step starts, when the executor checks; undefined offers them all. */
  readonly available?: ReadonlySet<string>;
  /** Re-checks which page object tools are live, after an action changed the page. */
  readonly refreshAvailable?: () => Promise<ReadonlySet<string>>;
  /** Records a grammar action the solver took through `ctx.actions`, with the control it acted on when known. */
  recordGrammar(name: string, target?: NodeTarget): void;
}

export interface Solver {
  readonly name: string;
  solve(step: SolveStep): Promise<{
    readonly verdict: StepVerdict;
    readonly log?: Record<string, unknown>;
  }>;
}

export function aymeExecutor(options: {
  tools: PageObjectTools;
  storeDir: string;
  solver: Solver;
  /**
   * How a page object call reaches the page: through e2e's tool accounting
   * (`budgets.runTool`: the action budget, the operation queue, a step event,
   * and a gap in e2e's recording), or straight to Playwright. `runTool` is
   * the default; `direct` exists to compare what e2e records.
   */
  route?: "runTool" | "direct";
  /** Checks, once per step the solver gets, which page object tools are live (`aymeAvailability`). */
  availability?: () => Promise<ReadonlySet<string>>;
  /** Where one JSON line per step goes (source: store or solver, calls, timing); `SPIKE_LOG` when unset. */
  logFile?: string;
  /**
   * `read-only` replays and proposes repairs but records nothing: no new
   * entries for solved steps, no adoption of shared entries. Pass e2e's own
   * cache mode so a check of a committed recording leaves it as it is.
   */
  mode?: "read-write" | "read-only";
}): StepExecutor {
  const store = new PageObjectStore(options.storeDir);
  const recording = options.mode !== "read-only";
  const logFile = options.logFile ?? process.env.SPIKE_LOG;
  const occurrences = (ctx: StepExecutorContext, shape: string): number => {
    const key = `ayme-e2e.occurrence:${shape}`;
    const next =
      ((ctx.attempt.memory.get(key) as number | undefined) ?? -1) + 1;
    ctx.attempt.memory.set(key, next);
    return next;
  };
  const runCall = (
    ctx: StepExecutorContext,
    tool: string,
    args: JsonValue,
    timeoutMs?: number
  ) => {
    const defined = options.tools[tool];
    if (defined === undefined)
      return Promise.reject(new Error(`no page object tool ${tool}`));
    const call = () =>
      executePageObjectTool(
        defined,
        args,
        timeoutMs === undefined ? {} : { aymeTimeoutMs: timeoutMs }
      );
    return options.route === "direct"
      ? call()
      : ctx.budgets.runTool({ name: tool, mutates: true }, call);
  };

  return {
    name: `ayme-${options.solver.name}`,
    version: "1",
    cache: "inherit",
    async runStep(ctx): Promise<StepVerdict> {
      if (ctx.step.kind !== "act") {
        return {
          status: "blocked",
          errorCode: "AUTOMATION_UNSUPPORTED",
          summary: "this executor runs act steps only",
        };
      }
      const step = {
        testId: ctx.attempt.testId,
        instruction: ctx.step.instruction,
        params: ctx.step.params,
      };
      const occurrence = occurrences(
        ctx,
        `${ctx.step.instruction}\n${Object.keys(ctx.step.params ?? {})
          .sort()
          .join(",")}`
      );
      const keys = store.keys({ ...step, occurrence });
      const hit = store.lookup(keys);
      const prefix = ctx.replayedPrefix;
      const startedMs = Date.now();
      let failed: { tool: string; args: JsonValue; error: string } | undefined;
      let skipped: string | undefined;

      if (hit !== undefined && !replayable(hit, prefix)) {
        skipped = `entry wants ${hit.entry.grammarBefore} replayed grammar actions before its calls; e2e replayed ${prefix?.replayedActions.length ?? 0} (${prefix?.stopReason ?? "no hand-off"})`;
      } else if (hit !== undefined) {
        try {
          for (const call of hit.entry.calls) {
            const args = fillArgs(call.args, ctx.step.params);
            if (args === undefined)
              throw new Error(
                `stored call ${call.tool} names a parameter this step lacks`
              );
            try {
              await runCall(ctx, call.tool, args, REPLAY_TIMEOUT_MS);
            } catch (cause) {
              failed = {
                tool: call.tool,
                args,
                error:
                  (cause instanceof Error
                    ? cause.message
                    : String(cause)
                  ).split("\n")[0] ?? "",
              };
              throw cause;
            }
          }
          // A shared entry that served this test becomes the test's own as well.
          if (hit.source === "shared" && recording)
            store.adopt(keys.test, hit.entry);
          log(logFile, ctx, {
            source: `store-${hit.source}`,
            calls: hit.entry.calls.map((call) => call.tool),
            wallMs: Date.now() - startedMs,
          });
          return {
            status: "passed",
            summary: `replayed ${hit.entry.calls.length} page object call(s) from the Ayme store (${hit.source} entry)`,
          };
        } catch (cause) {
          if (failed === undefined)
            failed = {
              tool: hit.entry.calls[0]?.tool ?? "?",
              args: null,
              error: String(cause),
            };
        }
      }

      const actions: StepAction[] = [];
      const note =
        failed === undefined
          ? undefined
          : `A recorded call of ${failed.tool} for this step just failed (${failed.error}). Do not call it again; reach the goal another way.`;
      const available =
        options.availability === undefined
          ? undefined
          : await options.availability();
      const { verdict, log: solverLog } = await options.solver.solve({
        ctx,
        ...(available === undefined ? {} : { available }),
        ...(options.availability === undefined
          ? {}
          : { refreshAvailable: options.availability }),
        ...(note === undefined ? {} : { note }),
        tools: options.tools,
        callTool: async (tool, args) => {
          const result = await runCall(ctx, tool, args);
          actions.push({ kind: "tool", tool, args });
          return result;
        },
        recordGrammar: (name, target) =>
          actions.push({
            kind: "grammar",
            name,
            ...(target === undefined ? {} : { target }),
            summary: describeAction(name, target),
          }),
      });
      let stored = false;
      let repair: string | undefined;
      if (verdict.status === "passed") {
        if (failed !== undefined)
          repair = store.proposeRepair(keys.test, failed, actions);
        else if (recording) stored = store.record(keys, step, actions);
      }
      log(logFile, ctx, {
        source: "solver",
        storeHit: hit?.source ?? null,
        available: available === undefined ? null : [...available],
        skipped: skipped ?? null,
        failedCall: failed ?? null,
        actions,
        stored,
        repair: repair ?? null,
        verdict: verdict.status,
        wallMs: Date.now() - startedMs,
        ...solverLog,
      });
      return verdict;
    },
  };
}

/**
 * Whether a stored entry fits what e2e already did this step. Grammar actions
 * the solver took before its calls are e2e's to replay: they must have run,
 * and replay must have stopped at the gap the first call left.
 */
function replayable(
  hit: StoreHit,
  prefix: StepExecutorContext["replayedPrefix"]
): boolean {
  const replayed = prefix?.replayedActions.length ?? 0;
  if (hit.entry.grammarBefore === 0) return replayed === 0;
  return replayed === hit.entry.grammarBefore && prefix?.stopReason === "gap";
}

function log(
  file: string | undefined,
  ctx: StepExecutorContext,
  entry: Record<string, unknown>
): void {
  if (file === undefined) return;
  appendFileSync(
    file,
    `${JSON.stringify({ phase: process.env.SPIKE_PHASE, test: ctx.attempt.testId, instruction: ctx.step.instruction, replayedPrefix: ctx.replayedPrefix ?? null, ...entry })}\n`
  );
}
