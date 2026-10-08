import type { JsonValue } from "./contracts";
import { RuntimeStateError } from "./errors";
import type { Caller } from "./interactionHistory";

/** Reads a Peek's current values when an agent asks. It may be async. */
export type PeekRead = () => unknown;

/** What a Peek Tool returns: the Peek's name and each live instance's read. */
export type PeekResult = {
  name: string;
  instances: (
    { id?: string; values: JsonValue } | { id?: string; error: string }
  )[];
};

/** A Peek's tool, `peek.<name>`: it takes no input and reads every live instance. */
export type PeekTool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, never>;
    additionalProperties: false;
  };
  execute(input: unknown): Promise<JsonValue>;
  executeAs(input: unknown, caller: Caller): Promise<JsonValue>;
};

/** One live instance of a Peek. */
type Instance = { read: PeekRead };

type Peek = {
  tool: PeekTool;
  /** By id; the instance added without one is under `undefined`. */
  instances: Map<string | undefined, Instance>;
};

type PeekRegistry = {
  /** By Peek name. A Peek stays here while it has an instance. */
  peeks: Map<string, Peek>;
  /** Every Peek Tool made, live or not. */
  tools: WeakSet<object>;
  listeners: Set<() => void>;
};

// On globalThis, so every bundle that loads Ayme in one process shares one
// set of Peeks.
const registry: PeekRegistry = ((
  globalThis as typeof globalThis & { __aymePeekRegistry?: PeekRegistry }
).__aymePeekRegistry ??= {
  peeks: new Map(),
  tools: new WeakSet(),
  listeners: new Set(),
});

/**
 * Package-internal: adds the instance (`name`, `id`) of a Peek. With an id,
 * a later call updates that instance's read, so every call's remover removes
 * it. Without one, a later call replaces the instance, so the earlier call's
 * remover does nothing, such as a reloaded module's old one. `ayme.peek`
 * checks `name` and the dev gate first.
 */
export function addPeek(read: PeekRead, name: string, id?: string): () => void {
  const peek = peekNamed(name);
  let instance = id === undefined ? undefined : peek.instances.get(id);
  if (instance) instance.read = read;
  else {
    const appears = peek.instances.size === 0;
    instance = { read };
    peek.instances.set(id, instance);
    if (appears) notify();
  }
  return () => {
    if (peek.instances.get(id) !== instance) return;
    peek.instances.delete(id);
    if (peek.instances.size === 0) withdrawWhenStillEmpty(name, peek);
  };
}

/** Package-internal: the tools of the Peeks with a live instance. */
export function listPeekTools(): PeekTool[] {
  return [...registry.peeks.values()].map(({ tool }) => tool);
}

/** Package-internal: calls `listener` after a Peek Tool appears or goes. */
export function subscribeToPeekTools(listener: () => void): () => void {
  registry.listeners.add(listener);
  return () => {
    registry.listeners.delete(listener);
  };
}

/** Package-internal: whether `tool` is a Peek Tool, which only reads. */
export function isPeekTool(tool: object): boolean {
  return registry.tools.has(tool);
}

/**
 * Package-internal: the Peek Tool name for a Peek name: `peek.<name>` in the
 * browser, and `peek.node.<name>` in a Node process of the app (an App
 * Process), so the agent tells the two sides apart and a Peek both
 * register under one name gives two tools.
 */
export function peekToolName(name: string) {
  const side = typeof window === "undefined" ? "peek.node." : "peek.";
  return side + name.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function peekNamed(name: string): Peek {
  const existing = registry.peeks.get(name);
  if (existing) return existing;
  const toolName = peekToolName(name);
  // `peek.node.` is the App Processes' side; a browser Peek may not read as one.
  if (typeof window !== "undefined" && toolName.startsWith("peek.node."))
    throw new RuntimeStateError(
      `The Peek "${name}" would be read through ${toolName}, which names an App Process's Peek. Rename it so it doesn't start with "node.".`
    );
  for (const [otherName, other] of registry.peeks)
    if (other.tool.name === toolName)
      throw new RuntimeStateError(
        `The Peek "${name}" would be read through ${toolName}, which the Peek "${otherName}" already uses. Rename one.`
      );
  const peek: Peek = { tool: createPeekTool(name), instances: new Map() };
  registry.tools.add(peek.tool);
  registry.peeks.set(name, peek);
  return peek;
}

// A component that remounts in one go, as React StrictMode's effects do,
// removes its instance and adds it again before this runs; the tool stays.
function withdrawWhenStillEmpty(name: string, peek: Peek) {
  queueMicrotask(() => {
    if (peek.instances.size > 0 || registry.peeks.get(name) !== peek) return;
    registry.peeks.delete(name);
    notify();
  });
}

function notify() {
  for (const listener of registry.listeners) listener();
}

function createPeekTool(name: string): PeekTool {
  const run = async (): Promise<JsonValue> => {
    const peek = registry.peeks.get(name);
    const instances = await Promise.all(
      [...(peek?.instances ?? [])].map(([id, { read }]) =>
        readInstance(id, read)
      )
    );
    const result: PeekResult = { name, instances };
    return result as JsonValue;
  };
  return {
    name: peekToolName(name),
    description: `Read the current values of the Peek "${name}" from each live instance.`,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: run,
    executeAs: run,
  };
}

async function readInstance(
  id: string | undefined,
  read: PeekRead
): Promise<PeekResult["instances"][number]> {
  const label = id === undefined ? {} : { id };
  try {
    return { ...label, values: toJson(await read()) };
  } catch (error) {
    return {
      ...label,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** `value` as JSON would carry it; `null` for what JSON has no form of. */
function toJson(value: unknown): JsonValue {
  const text = JSON.stringify(value);
  return text === undefined ? null : (JSON.parse(text) as JsonValue);
}
