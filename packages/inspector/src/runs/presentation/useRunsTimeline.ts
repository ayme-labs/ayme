import { useEffect, useRef, useState } from "react";

import { useCopy } from "../../shared";
import type { RunFocus } from "../domain/run";

/**
 * The timeline's own state: which runs are closed, which results are open,
 * the run a focus brings into view, opened and flashing briefly, the
 * result just copied, and when the timeline last opened. Once a focus is in
 * view, `onFocusShown` lets it go, so a remount doesn't show it again.
 */
export function useRunsTimeline(
  focus: RunFocus | undefined,
  open: boolean,
  onFocusShown?: () => void
) {
  const [closedRuns, setClosedRuns] = useState<ReadonlySet<string>>(new Set());
  const [openResults, setOpenResults] = useState<ReadonlySet<string>>(
    new Set()
  );
  // The focus itself, not its run, so asking for a run again flashes anew.
  const [flashing, setFlashing] = useState<RunFocus>();
  const { copied, copy } = useCopy();
  const timeline = useRef<HTMLOListElement>(null);
  const [shownAt, setShownAt] = useState(Date.now);
  const [shown, setShown] = useState(open);
  if (open !== shown) {
    setShown(open);
    setShownAt(Date.now());
  }

  useEffect(() => {
    if (!focus) return;
    setClosedRuns((closed) => {
      const next = new Set(closed);
      next.delete(focus.runId);
      return next;
    });
    setOpenResults((opened) => new Set(opened).add(focus.runId));
    setFlashing(focus);
    const row = timeline.current?.querySelector(
      `[data-run-id="${focus.runId}"]`
    );
    row?.scrollIntoView({ block: "nearest" });
    onFocusShown?.();
  }, [focus]);

  useEffect(() => {
    if (!flashing) return;
    const timer = setTimeout(() => setFlashing(undefined), 1800);
    return () => clearTimeout(timer);
  }, [flashing]);

  return {
    timeline,
    closedRuns,
    openResults,
    flashing: flashing?.runId,
    toggleRun: (id: string) => setClosedRuns((closed) => toggled(closed, id)),
    toggleResult: (id: string) =>
      setOpenResults((opened) => toggled(opened, id)),
    copiedResult: copied,
    copyResult: (id: string, text: string) => copy(text, id),
    openImage: openImageFullSize,
    shownAt,
  };
}

/** The set with `id` added, or removed if it was there. */
function toggled(set: ReadonlySet<string>, id: string) {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Opens an image, given its base64 data URL, full size in a new tab,
 * through a blob URL, as a tab won't open a data URL. Synchronous, so the
 * tab opens within the click and no popup blocker stops it.
 */
export function openImageFullSize(src: string) {
  const [header = "", data = ""] = src.split(",", 2);
  const type = /^data:([^;]+)/.exec(header)?.[1] ?? "";
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  window.open(url, "_blank", "noopener");
  // Long enough for the tab to load it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
