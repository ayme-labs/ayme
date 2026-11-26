/**
 * Notes on stale Page Objects: what a run leaves behind when a call of a
 * Page Object Tool fails, for whoever fixes the Page Object afterwards.
 *
 * A call that fails while a recording replays is the strong sign: it worked
 * when it was recorded and the screen it ran on has changed. The note names
 * the action, its source file, the error with the locator it waited for, and
 * the test and step. Nothing is fixed during the run.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { JsonValue } from "e2e";
import { NotAvailable, type ToolSource } from "./direct";

/** A call of a tool that threw. */
export interface ToolFailure {
  /** The tool, as the agent and the recording name it. */
  readonly tool: string;
  readonly input: JsonValue;
  readonly error: unknown;
  /** Whether a recording was replaying the call, or the agent made it live. */
  readonly during: "replay" | "live";
  readonly test: string;
  readonly instruction: string;
}

/** Writes one note per failed call into `dir`; a later failure of the same call in the same step replaces it. */
export function staleNotes(
  dir: string,
  sourceOf: (tool: string) => ToolSource | undefined
): (failure: ToolFailure) => void {
  return (failure) => {
    // The agent calling an action whose part is not showing is an ordinary
    // refusal. Only a recording that expected the part is a sign of change.
    if (failure.during === "live" && failure.error instanceof NotAvailable)
      return;
    const message = String(
      failure.error instanceof Error ? failure.error.message : failure.error
    );
    const key = createHash("sha256")
      .update(`${failure.test}\n${failure.instruction}\n${failure.tool}`)
      .digest("hex")
      .slice(0, 12);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${failure.tool}-${failure.during}-${key}.json`),
      `${JSON.stringify(
        {
          schemaVersion: "ayme-stale-1",
          at: new Date().toISOString(),
          during: failure.during,
          tool: failure.tool,
          pageObject: sourceOf(failure.tool),
          input: failure.input,
          refused: failure.error instanceof NotAvailable,
          // With the engine's call log: the locator it waited for.
          error: message.split("\n").slice(0, 12).join("\n"),
          test: decodeURIComponent(failure.test),
          step: failure.instruction,
        },
        null,
        2
      )}\n`
    );
  };
}
