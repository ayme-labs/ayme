import { useSyncExternalStore } from "react";

import {
  getInspectorTrace,
  subscribeToInspectorTrace,
  type TraceEntry,
} from "./trace";

let snapshot: readonly TraceEntry[] = [];

// getInspectorTrace returns a fresh copy on every call; hand React the same
// array until an entry actually changes, as useSyncExternalStore requires.
function getSnapshot() {
  const trace = getInspectorTrace();
  if (
    trace.length !== snapshot.length ||
    trace.some((entry, index) => entry !== snapshot[index])
  )
    snapshot = trace;
  return snapshot;
}

function subscribe(onChange: () => void) {
  const unsubscribe = subscribeToInspectorTrace(onChange);
  return () => {
    unsubscribe();
  };
}

/** The live browser trace of the current Page. */
export function useInspectorTrace() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
