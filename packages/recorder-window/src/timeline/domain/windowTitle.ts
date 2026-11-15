import type { RecordedVisit } from "@ayme-dev/recorder/contract";

/**
 * The window's title: the recorder, and the address of the page the
 * recording is on now, its latest Visit's. The state names no page before
 * the first Visit, so the title names the recorder alone then.
 */
export function windowTitle(visits: readonly RecordedVisit[]): string {
  const now = visits.at(-1);
  return now ? `Ayme Recorder - ${now.url}` : "Ayme Recorder";
}
