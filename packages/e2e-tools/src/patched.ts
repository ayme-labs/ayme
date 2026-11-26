/**
 * What the patched e2e adds, as this package uses it. The patches
 * (`patches/@e2e-dev__core@0.25.0.patch`, `patches/@e2e-dev__acp@0.1.4.patch`)
 * type it in their own `.d.ts`; it is typed again here so this package
 * builds on e2e as published, where the study's other arms run.
 */

import type { JsonValue, StepExecutorContext } from "e2e";

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
