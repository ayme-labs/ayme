/**
 * The page object call store: what e2e's own replay cache cannot keep.
 *
 * Stock e2e records a mutating project tool call as a gap and stops replay
 * there, so a step finished through a page object reaches the executor on
 * every run. This store answers those steps without a model: it keeps, per
 * step, the page object calls the solver made and replays them.
 *
 * Two lookups: by test (test id, the step's occurrence in the attempt, the
 * instruction, and its parameter names) and shared (instruction and
 * parameter names only), so every test that shares a step shares one entry.
 * Arguments are stored with each value that equals a step parameter replaced
 * by `{ "$param": name }`, and filled from the current step's parameters on
 * replay: e2e does not tell an executor which params were `unique()`, so the
 * store matches by value instead.
 *
 * A failed replay keeps the entry (fix the page object and it replays again)
 * and writes the passing live flow as a repair proposal beside it.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { JsonValue } from "e2e";
import type { NodeTarget } from "./describe.ts";

/** One action a solver took in a step, in order: a grammar verb or a page object call. */
export type StepAction =
  | {
      readonly kind: "grammar";
      readonly name: string;
      readonly target?: NodeTarget;
      readonly summary?: string;
    }
  | { readonly kind: "tool"; readonly tool: string; readonly args: JsonValue };

export interface StoredCall {
  readonly tool: string;
  readonly args: JsonValue;
}

/** A stored step: grammar actions e2e replays first (counted), then the page object calls this store replays. */
export interface StoreEntry {
  readonly schemaVersion: "ayme-store-1";
  readonly createdAt: string;
  readonly instruction: string;
  readonly testId: string;
  readonly grammarBefore: number;
  readonly calls: readonly StoredCall[];
}

export type StoreHit = {
  readonly source: "test" | "shared";
  readonly entry: StoreEntry;
};

const digest = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 32);
const normalize = (instruction: string): string =>
  instruction.replace(/\r\n?/g, "\n").normalize("NFC").trim();

/** A primitive's identity for parameter matching: its type and value, so `1` and `"1"` stay apart. */
const primitiveKey = (value: string | number | boolean): string =>
  `${typeof value}:${String(value)}`;

/** Arguments with each primitive value that equals a step parameter written as a reference to it. */
export function templateArgs(
  args: JsonValue,
  params: Readonly<Record<string, JsonValue>> | undefined
): JsonValue {
  const byValue = new Map(
    Object.entries(params ?? {})
      .filter((entry): entry is [string, string | number | boolean] =>
        ["string", "number", "boolean"].includes(typeof entry[1])
      )
      .map(([name, value]) => [primitiveKey(value), name])
  );
  const walk = (value: JsonValue): JsonValue => {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      const name = byValue.get(primitiveKey(value));
      return name === undefined ? value : { $param: name };
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, walk(item)])
      );
    return value;
  };
  return walk(args);
}

/** Stored arguments filled from the current step's parameters; undefined when one names a parameter the step lacks. */
export function fillArgs(
  args: JsonValue,
  params: Readonly<Record<string, JsonValue>> | undefined
): JsonValue | undefined {
  let missing = false;
  const walk = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      const ref = (value as { $param?: unknown }).$param;
      if (typeof ref === "string" && Object.keys(value).length === 1) {
        const filled = params?.[ref];
        if (filled === undefined) missing = true;
        return filled ?? null;
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, walk(item)])
      );
    }
    return value;
  };
  const filled = walk(args);
  return missing ? undefined : filled;
}

export class PageObjectStore {
  constructor(private readonly dir: string) {}

  /** The step's two keys: its own, and the one every test with the same instruction shares. */
  keys(step: {
    testId: string;
    occurrence: number;
    instruction: string;
    params: Readonly<Record<string, JsonValue>> | undefined;
  }) {
    const shape = `${normalize(step.instruction)}\n${Object.keys(
      step.params ?? {}
    )
      .sort()
      .join(",")}`;
    return {
      test: digest(`${step.testId}\n${step.occurrence}\n${shape}`),
      shared: digest(shape),
    };
  }

  lookup(keys: { test: string; shared: string }): StoreHit | undefined {
    const test = this.read("tests", keys.test);
    if (test !== undefined) return { source: "test", entry: test };
    const shared = this.read("shared", keys.shared);
    return shared === undefined
      ? undefined
      : { source: "shared", entry: shared };
  }

  /** Stores a solved step under both keys, when it ended in page object calls with nothing after them but more calls. */
  record(
    keys: { test: string; shared: string },
    step: {
      instruction: string;
      testId: string;
      params: Readonly<Record<string, JsonValue>> | undefined;
    },
    actions: readonly StepAction[]
  ): boolean {
    const firstCall = actions.findIndex((action) => action.kind === "tool");
    if (
      firstCall === -1 ||
      actions.slice(firstCall).some((action) => action.kind !== "tool")
    )
      return false;
    const entry: StoreEntry = {
      schemaVersion: "ayme-store-1",
      createdAt: new Date().toISOString(),
      instruction: step.instruction,
      testId: step.testId,
      grammarBefore: firstCall,
      calls: actions.slice(firstCall).map((action) => {
        const call = action as Extract<StepAction, { kind: "tool" }>;
        return { tool: call.tool, args: templateArgs(call.args, step.params) };
      }),
    };
    this.write("tests", keys.test, entry);
    this.write("shared", keys.shared, entry);
    return true;
  }

  /** Copies an entry a shared lookup served under the step's own key, so the test holds its own record. */
  adopt(testKey: string, entry: StoreEntry): void {
    this.write("tests", testKey, entry);
  }

  /** Writes the live flow that passed after a stored call failed; returns the file. */
  proposeRepair(
    key: string,
    failed: StoredCall & { readonly error: string },
    fallback: readonly StepAction[]
  ): string {
    const file = path.join(this.dir, "repairs", `${failed.tool}-${key}.json`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ schemaVersion: "ayme-repair-1", createdAt: new Date().toISOString(), ...failed, fallback }, null, 2)}\n`
    );
    return file;
  }

  private read(kind: "tests" | "shared", key: string): StoreEntry | undefined {
    try {
      const entry = JSON.parse(
        readFileSync(path.join(this.dir, kind, `${key}.json`), "utf8")
      ) as StoreEntry;
      return entry.schemaVersion === "ayme-store-1" ? entry : undefined;
    } catch {
      return undefined;
    }
  }

  private write(
    kind: "tests" | "shared",
    key: string,
    entry: StoreEntry
  ): void {
    const file = path.join(this.dir, kind, `${key}.json`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`);
  }
}
