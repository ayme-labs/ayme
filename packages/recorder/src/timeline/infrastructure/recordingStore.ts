import { mkdir, rename, rm, writeFile } from "node:fs/promises";
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
 *
 * Both are written under a temporary name and renamed, so that whoever
 * looks while the package is written, or stops the recorder then, finds a
 * whole package or none. A save that cannot be completed leaves nothing
 * behind.
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
  const temporaryFolder = join(recordings, `.${recordingId}.tmp`);
  const temporaryLatest = join(recordings, `.${recordingId}.latest.tmp`);
  let renamed = false;
  try {
    // What a save that was cut short left there is in the way.
    await rm(temporaryFolder, { recursive: true, force: true });
    await mkdir(temporaryFolder, { recursive: true });
    await writeFile(join(temporaryFolder, "package.yaml"), text);
    await writeFile(temporaryLatest, text);
    await rm(folder, { recursive: true, force: true });
    await rename(temporaryFolder, folder);
    renamed = true;
    await rename(temporaryLatest, join(recordings, "latest.yaml"));
  } catch (error) {
    // Whatever the clean-up meets, the save failed for its own reason.
    const remove = (path: string) =>
      rm(path, { recursive: true, force: true }).catch(() => {});
    await remove(temporaryFolder);
    await remove(temporaryLatest);
    if (renamed) await remove(folder);
    throw error;
  }
  // The released recorder's "latest" of a semantic recording: this
  // recording is the latest now.
  await rm(join(recordings, "latest.json"), { force: true });
  return folder;
}
