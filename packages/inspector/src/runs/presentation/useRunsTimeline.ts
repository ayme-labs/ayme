import { useEffect, useRef, useState } from "react";

import type { RunFocus } from "../domain/run";

/**
 * The timeline's own state: which runs are closed, which results are open,
 * and the run a focus brings into view, opened and flashing briefly.
 */
export function useRunsTimeline(focus: RunFocus | undefined) {
  const [closedRuns, setClosedRuns] = useState<ReadonlySet<number>>(new Set());
  const [openResults, setOpenResults] = useState<ReadonlySet<number>>(
    new Set()
  );
  const [flashing, setFlashing] = useState<number>();
  const timeline = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!focus) return;
    setClosedRuns((closed) => {
      const next = new Set(closed);
      next.delete(focus.runId);
      return next;
    });
    setOpenResults((opened) => new Set(opened).add(focus.runId));
    setFlashing(focus.runId);
    const row = timeline.current?.querySelector(
      `[data-run-id="${focus.runId}"]`
    );
    row?.scrollIntoView({ block: "nearest" });
    const timer = setTimeout(() => setFlashing(undefined), 1800);
    return () => clearTimeout(timer);
  }, [focus]);

  return {
    timeline,
    closedRuns,
    openResults,
    flashing,
    toggleRun: (id: number) => setClosedRuns((closed) => toggled(closed, id)),
    toggleResult: (id: number) =>
      setOpenResults((opened) => toggled(opened, id)),
    copyResult: (text: string) => void copy(text),
  };
}

/** The set with `id` added, or removed if it was there. */
function toggled(set: ReadonlySet<number>, id: number) {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The page can deny the clipboard; the result can still be selected.
  }
}
