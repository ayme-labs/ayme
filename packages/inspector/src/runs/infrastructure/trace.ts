import type { Locator } from "@playwright/test";

import type { TraceEntry } from "../domain/run";

const trace: TraceEntry[] = [];
// The locator each entry acted on, so a run's step can find its element.
const locators = new WeakMap<TraceEntry, Locator>();
const traceDispatchSubscribers = new Set<
  (entry: TraceEntry, locator?: Locator) => void
>();

export function dispatchInspectorTrace(entry: TraceEntry, locator?: Locator) {
  for (const subscriber of traceDispatchSubscribers) subscriber(entry, locator);
}

export function recordInspectorTrace(entry: TraceEntry, locator?: Locator) {
  trace.push(entry);
  if (locator) locators.set(entry, locator);
}

export function getInspectorTrace(): readonly TraceEntry[] {
  return [...trace];
}

/** The locator a recorded entry acted on. */
export function traceEntryLocator(entry: TraceEntry): Locator | undefined {
  return locators.get(entry);
}

export function resetInspectorTrace() {
  trace.splice(0);
}

export function subscribeToInspectorTraceDispatcher(
  subscriber: (entry: TraceEntry, locator?: Locator) => void
) {
  traceDispatchSubscribers.add(subscriber);
  return () => traceDispatchSubscribers.delete(subscriber);
}
