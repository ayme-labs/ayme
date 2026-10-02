import type { JsonValue } from "./contracts";
import type { ModelContextTool } from "@mcp-b/webmcp-types";
import { ToolInputError } from "./errors";

// Throwaway getter/lifecycle experiment. No serialization or async policy.
export type PrototypePeek = {
  id: string;
  label: string;
  value: JsonValue;
};
const peeks = new WeakMap<
  Document,
  Map<string, Omit<PrototypePeek, "value"> & { read(): JsonValue }>
>();
const subscribers = new Set<() => void>();

export function subscribeToPrototypePeeks(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

function notify() {
  for (const subscriber of subscribers) subscriber();
}

export function registerPrototypePeek(
  currentDocument: Document,
  id: string,
  label: string,
  read: () => JsonValue
) {
  let entries = peeks.get(currentDocument);
  if (!entries) peeks.set(currentDocument, (entries = new Map()));
  entries.set(id, { id, label, read });
  notify();
  return {
    dispose: () => {
      if (entries.delete(id)) notify();
    },
  };
}

export function collectPrototypePeeks(
  currentDocument: Document
): PrototypePeek[] {
  return [...(peeks.get(currentDocument)?.values() ?? [])].map(
    ({ id, label, read }) => ({ id, label, value: read() })
  );
}

// Keep the one discovery tool available after the last peek unmounts. Only
// documents that have used this throwaway registry opt into its publication.
export function getPrototypePeekTool() {
  return typeof document !== "undefined" && peeks.has(document)
    ? prototypePeekTool
    : undefined;
}

export const prototypePeekTool = {
  name: "peek",
  description:
    "Throwaway peek prototype. Call with {} to list live instance IDs and labels without evaluating getters. Call with { id } to read only that instance's latest committed value. IDs expire on unmount.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "A live instance ID from peek({}). Omit to discover instances.",
      },
    },
    required: [],
    additionalProperties: false,
  } as const,
  execute(input: unknown): JsonValue {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new ToolInputError("peek requires an object input.");
    if (Object.keys(input).some((key) => key !== "id"))
      throw new ToolInputError("peek accepts only the optional id field.");
    const entries = peeks.get(document);
    if (!("id" in input))
      return {
        peeks: [...(entries?.values() ?? [])].map(({ id, label }) => ({
          id,
          label,
        })),
      };
    if (typeof input.id !== "string")
      throw new ToolInputError("peek id must be a string.");
    const entry = entries?.get(input.id);
    if (!entry)
      throw new ToolInputError(`Peek instance "${input.id}" is not live.`);
    return { id: entry.id, label: entry.label, value: entry.read() };
  },
} satisfies ModelContextTool<{ id?: string }, JsonValue>;
