/**
 * What the patched e2e adds, as this package uses it. The patches in
 * `../patches` change e2e's JavaScript only, as `e2e-patched` loads it, so
 * the installed e2e and its types stay the published ones; this is their
 * one typed view.
 */

import type { JsonValue, StepExecutorContext } from "e2e";

/**
 * Throws unless this process runs e2e patched, that is under `e2e-patched`.
 * A config that needs the patches calls it, so a plain `e2e run` of it stops
 * at once instead of failing on the first call.
 */
export function assertPatchedE2e(config: string): void {
  if (
    (globalThis as Record<symbol, unknown>)[
      Symbol.for("@ayme-dev/e2e-tools.patched-e2e")
    ] !== true
  )
    throw new Error(
      `${config} needs the patched e2e: run it with e2e-patched (@ayme-dev/e2e-tools), not e2e`
    );
}

/** The step's tool accounting, with the input a call can be repeated with. */
export type PatchedBudgets = {
  runTool<T>(
    call: { name: string; mutates: boolean; replay?: { input: JsonValue } },
    body: () => Promise<T>
  ): Promise<T>;
};

/** `ctx.budgets` as the patched e2e takes it. */
export const budgetsOf = (ctx: StepExecutorContext): PatchedBudgets =>
  ctx.budgets as PatchedBudgets;

/** The newest attempt's `screen` and fixtures, which the patched e2e keeps for project tools. */
export type PatchedScreens = {
  readonly current: object;
  readonly fixtures: Record<string, unknown>;
};

export const patchedScreens = (): PatchedScreens | undefined =>
  (globalThis as Record<symbol, PatchedScreens | undefined>)[
    Symbol.for("e2e.patch.screens")
  ];

/** One tool of the patched `@e2e-dev/acp`'s `tools` option (`AcpExtraTool` there). */
export interface ServedTool {
  readonly name: string;
  readonly description: string;
  /** A zod object schema, as the ACP executor's MCP server registers it. */
  readonly inputSchema: unknown;
  readonly readOnly: boolean;
  /** When set, the tool is listed only while this answers false (`hidden` in the ACP patch). */
  readonly hidden?: (ctx: StepExecutorContext) => boolean | Promise<boolean>;
  run(
    args: unknown,
    step: {
      readonly ctx: StepExecutorContext;
      /** e2e's view of the screen: what changed since the agent last saw it. */
      observe(): Promise<string>;
      /** Set when a cached replay repeats the call. */
      readonly replaying?: boolean;
    }
  ): Promise<string>;
}
