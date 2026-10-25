import type { JsonValue } from "../../shared";
import { RuntimeStateError } from "../../shared";

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
  /** A read: no Change Record, so it takes no Run context. */
  execute(input: unknown): Promise<JsonValue>;
};

/**
 * Where a Peek is added: the browser, or a Node process of the app (an App
 * Process). The runtime tells which.
 */
export type PeekSide = "browser" | "node";

/** One live instance of a Peek. */
type Instance = { read: PeekRead };

type Peek = {
  tool: PeekTool;
  /** By id; the instance added without one is under `undefined`. */
  instances: Map<string | undefined, Instance>;
};

/**
 * Package-internal: the state of a set of Peeks. Its shape is shared by
 * every bundle that loads Ayme in one process, so it changes only with care.
 */
export type PeekStore = {
  /** By Peek name. A Peek stays here while it has an instance. */
  peeks: Map<string, Peek>;
  /** Every Peek Tool made, live or not. */
  tools: WeakSet<object>;
  listeners: Set<() => void>;
};

/** Package-internal: a store with no Peeks. */
export function emptyPeekStore(): PeekStore {
  return { peeks: new Map(), tools: new WeakSet(), listeners: new Set() };
}

/** Package-internal: the Peek operations on `store`. */
export function createPeekRegistry(store: PeekStore) {
  function peekNamed(side: PeekSide, name: string): Peek {
    const existing = store.peeks.get(name);
    if (existing) return existing;
    const toolName = peekToolName(side, name);
    // `peek.node.` is the App Processes' side; a browser Peek may not read as one.
    if (side === "browser" && toolName.startsWith("peek.node."))
      throw new RuntimeStateError(
        `The Peek "${name}" would be read through ${toolName}, which names an App Process's Peek.`
      );
    for (const [otherName, other] of store.peeks)
      if (other.tool.name === toolName)
        throw new RuntimeStateError(
          `The Peek "${name}" would be read through ${toolName}, which the Peek "${otherName}" already uses.`
        );
    const peek: Peek = {
      tool: createPeekTool(store, toolName, name),
      instances: new Map(),
    };
    store.tools.add(peek.tool);
    store.peeks.set(name, peek);
    return peek;
  }

  // A component that remounts in one go, as React StrictMode's effects do,
  // removes its instance and adds it again before this runs; the tool stays.
  function withdrawWhenStillEmpty(name: string, peek: Peek) {
    queueMicrotask(() => {
      if (peek.instances.size > 0 || store.peeks.get(name) !== peek) return;
      store.peeks.delete(name);
      notify();
    });
  }

  function notify() {
    for (const listener of store.listeners) listener();
  }

  return {
    /**
     * Adds the instance (`name`, `id`) of a Peek on `side`. With an id, a
     * later call updates that instance's read, so every call's remover
     * removes it. Without one, a later call replaces the instance, so the
     * earlier call's remover does nothing, such as a reloaded module's old
     * one. `ayme.peek` checks `name` and the dev gate first.
     */
    addPeek(
      side: PeekSide,
      read: PeekRead,
      name: string,
      id?: string
    ): () => void {
      const peek = peekNamed(side, name);
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
    },
    /** The tools of the Peeks with a live instance. */
    listPeekTools: (): PeekTool[] =>
      [...store.peeks.values()].map(({ tool }) => tool),
    /** Calls `listener` after a Peek Tool appears or goes. */
    subscribeToPeekTools(listener: () => void): () => void {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    /** Whether `tool` is a Peek Tool, which only reads. */
    isPeekTool: (tool: object): boolean => store.tools.has(tool),
  };
}

/**
 * Package-internal: the Peek Tool name for a Peek name on `side`:
 * `peek.<name>` in the browser, and `peek.node.<name>` in a Node process of
 * the app (an App Process), so the agent tells the two sides apart and a
 * Peek both register under one name gives two tools.
 */
export function peekToolName(side: PeekSide, name: string) {
  const prefix = side === "node" ? "peek.node." : "peek.";
  return prefix + name.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function createPeekTool(
  store: PeekStore,
  toolName: string,
  name: string
): PeekTool {
  const inputSchema: PeekTool["inputSchema"] = {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
  const run = async (): Promise<JsonValue> => {
    const peek = store.peeks.get(name);
    const instances = await Promise.all(
      [...(peek?.instances ?? [])].map(([id, { read }]) =>
        readInstance(id, read)
      )
    );
    const result: PeekResult = { name, instances };
    return result as JsonValue;
  };
  return {
    name: toolName,
    description: `Read the current values of the Peek "${name}" from each live instance.`,
    inputSchema,
    execute: run,
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
