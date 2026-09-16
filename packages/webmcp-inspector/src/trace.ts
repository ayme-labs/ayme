export type TraceEntry = {
  operation:
    "click" | "fill" | "press" | "pressSequentially" | "waitFor" | "expect";
  locator: string;
  value?: string;
  state?: string;
};

const trace: TraceEntry[] = [];
const traceDispatchSubscribers = new Set<(entry: TraceEntry) => void>();
const subscribers = new Set<() => void>();

export function dispatchInspectorTrace(entry: TraceEntry) {
  for (const subscriber of traceDispatchSubscribers) subscriber(entry);
}

export function recordInspectorTrace(entry: TraceEntry) {
  trace.push(entry);
  for (const subscriber of subscribers) subscriber();
}

export function getInspectorTrace(): readonly TraceEntry[] {
  return [...trace];
}

export function resetInspectorTrace() {
  trace.splice(0);
  for (const subscriber of subscribers) subscriber();
}

export function subscribeToInspectorTraceDispatcher(
  subscriber: (entry: TraceEntry) => void
) {
  traceDispatchSubscribers.add(subscriber);
  return () => traceDispatchSubscribers.delete(subscriber);
}

export function subscribeToInspectorTrace(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}
