import type { RecorderUpdate } from "@ayme-dev/recorder/contract";

/** The update to show: the one heard now, unless the one already shown is
 * as new or newer. Each update is the full state, so one that comes late
 * has nothing the newer one lacks. */
export function newest(
  shown: RecorderUpdate | null,
  heard: RecorderUpdate
): RecorderUpdate {
  return shown && heard.revision <= shown.revision ? shown : heard;
}
