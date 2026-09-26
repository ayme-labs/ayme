import type { Locator } from "@playwright/test";

export type TraceEntry = {
  operation:
    "click" | "fill" | "press" | "pressSequentially" | "waitFor" | "expect";
  locator: string;
  value?: string;
  state?: string;
};

const trace: TraceEntry[] = [];
// The locator each entry acted on, so a run's step can find its element.
const locators = new WeakMap<TraceEntry, Locator>();
const traceDispatchSubscribers = new Set<
  (entry: TraceEntry, locator?: Locator) => void
>();
const subscribers = new Set<() => void>();

export function dispatchInspectorTrace(entry: TraceEntry, locator?: Locator) {
  for (const subscriber of traceDispatchSubscribers) subscriber(entry, locator);
}

export function recordInspectorTrace(entry: TraceEntry, locator?: Locator) {
  trace.push(entry);
  if (locator) locators.set(entry, locator);
  for (const subscriber of subscribers) subscriber();
}

export function getInspectorTrace(): readonly TraceEntry[] {
  return [...trace];
}

/** The locator a recorded entry, or a copy of one, acted on. */
export function traceEntryLocator(entry: TraceEntry): Locator | undefined {
  return locators.get(entry);
}

/** Lets a copy of a recorded entry find the entry's locator. */
export function copyTraceEntryLocator(copy: TraceEntry, entry: TraceEntry) {
  const locator = locators.get(entry);
  if (locator) locators.set(copy, locator);
}

export function resetInspectorTrace() {
  trace.splice(0);
  for (const subscriber of subscribers) subscriber();
}

export function subscribeToInspectorTraceDispatcher(
  subscriber: (entry: TraceEntry, locator?: Locator) => void
) {
  traceDispatchSubscribers.add(subscriber);
  return () => traceDispatchSubscribers.delete(subscriber);
}

export function subscribeToInspectorTrace(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}
