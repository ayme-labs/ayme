export type TraceEntry = {
  operation:
    "click" | "fill" | "press" | "pressSequentially" | "waitFor" | "expect";
  locator: string;
  value?: string;
  state?: string;
};

const trace: TraceEntry[] = [];
const subscribers = new Set<() => void>();

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

export function subscribeToInspectorTrace(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}
