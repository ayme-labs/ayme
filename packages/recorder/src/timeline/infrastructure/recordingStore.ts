import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Timeline } from "../domain/timeline";

/**
 * Writes a timeline as a Recording Package where the released recorder
 * keeps its recordings, in the project:
 *
 *     .ayme/recordings/<recordingId>/package.yaml
 *     .ayme/recordings/latest.yaml      the same text
 *
 * Resolves with the package's folder, or with null when the timeline has
 * nothing to write: nothing is written then.
 */
export async function saveRecording(
  timeline: Timeline,
  options: { readonly projectDir: string; readonly createdAt: Date }
): Promise<string | null> {
  const createdAt = options.createdAt.toISOString();
  const recordingId = `rec_${createdAt.replace(/[-:.]/g, "")}`;
  // No trace is recorded yet.
  const text = await timeline.package({
    recordingId,
    createdAt,
    tracePath: null,
  });
  if (text === null) return null;
  const recordings = join(options.projectDir, ".ayme", "recordings");
  const folder = join(recordings, recordingId);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "package.yaml"), text);
  await writeFile(join(recordings, "latest.yaml"), text);
  // The released recorder's "latest" of a semantic recording: this
  // recording is the latest now.
  await rm(join(recordings, "latest.json"), { force: true });
  return folder;
}
