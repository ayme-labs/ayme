import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type { RecordingTrace } from "../domain/recorded";
import type { Timeline } from "../domain/timeline";

/**
 * Writes a timeline as a Recording Package where the released recorder
 * keeps its recordings, in the project:
 *
 *     ayme/recordings/<recordingId>/package.yaml
 *     ayme/recordings/<recordingId>/trace.zip   when the recording has one
 *     ayme/recordings/latest.yaml      the same text as the package
 *     ayme/.gitignore                  with the recordings folder ignored
 *
 * Resolves with the package's folder, or with null when the timeline has
 * nothing to write: nothing is written then.
 *
 * The folder and `latest.yaml` are written under a temporary name and
 * renamed, the trace file in the folder, so that whoever looks while the
 * package is written, or stops the recorder then, finds a whole package or
 * none. A save that cannot be completed leaves nothing behind. The trace's
 * own file, in the place the browser wrote it, is the store's to remove
 * whatever comes of the save.
 */
export async function saveRecording(
  timeline: Timeline,
  options: {
    readonly projectDir: string;
    readonly createdAt: Date;
    readonly trace: RecordingTrace | null;
  }
): Promise<string | null> {
  const { trace } = options;
  try {
    return await write(timeline, options);
  } finally {
    if (trace) await rm(trace.file, { force: true });
  }
}

async function write(
  timeline: Timeline,
  options: {
    readonly projectDir: string;
    readonly createdAt: Date;
    readonly trace: RecordingTrace | null;
  }
): Promise<string | null> {
  const { trace } = options;
  const createdAt = options.createdAt.toISOString();
  const recordingId = `rec_${createdAt.replace(/[-:.]/g, "")}`;
  const text = await timeline.package(
    {
      recordingId,
      createdAt,
      // Relative to the project, with forward slashes, as the released
      // recorder writes it.
      tracePath: trace ? `ayme/recordings/${recordingId}/trace.zip` : null,
    },
    trace?.positions
  );
  if (text === null) return null;
  // A `.gitignore` that cannot be read or added to, a read-only one for
  // one, does not stand in the way of the save.
  await ignoreWhatIsKept(join(options.projectDir, "ayme")).catch(() => {});
  const recordings = join(options.projectDir, "ayme", "recordings");
  const folder = join(recordings, recordingId);
  const temporaryFolder = join(recordings, `.${recordingId}.tmp`);
  const temporaryLatest = join(recordings, `.${recordingId}.latest.tmp`);
  let renamed = false;
  try {
    // What a save that was cut short left there is in the way.
    await rm(temporaryFolder, { recursive: true, force: true });
    await mkdir(temporaryFolder, { recursive: true });
    await writeFile(join(temporaryFolder, "package.yaml"), text);
    if (trace) await copyFile(trace.file, join(temporaryFolder, "trace.zip"));
    await writeFile(temporaryLatest, text);
    await rm(folder, { recursive: true, force: true });
    await rename(temporaryFolder, folder);
    renamed = true;
    await rename(temporaryLatest, join(recordings, "latest.yaml"));
  } catch (error) {
    // Whatever the clean-up meets, such as nothing to remove, the save
    // failed for its own reason.
    const remove = (path: string) =>
      rm(path, { recursive: true }).catch(() => {});
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

/**
 * Keeps the recordings out of the project's commits: the `.gitignore` of
 * `ayme/` lists the recordings folder, where the recorder also keeps its
 * temporary files. A new file lists itself too, as the released recorder's
 * does. A file that is there already, the project's own or the one
 * `ayme mcp` wrote, keeps its text and gets the folder's line, unless a line
 * of its own already ignores the folder or takes it back in.
 *
 * The file is created only when it is not there, and every write, the
 * first one too, adds at its end. It is never written anew from what was
 * read, nor from its start, which would drop a line `ayme mcp` adds at the
 * same moment.
 */
async function ignoreWhatIsKept(ayme: string): Promise<void> {
  await mkdir(ayme, { recursive: true });
  const file = join(ayme, ".gitignore");
  const created = await writeFile(file, "recordings/\n.gitignore\n", {
    flag: "ax",
  }).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      return false;
    }
  );
  if (created) return;
  const before = await readFile(file, "utf8");
  // As git reads the file: a byte order mark at its start, a carriage
  // return at a line's end and spaces before it do not count; a tab there,
  // or a space at the line's start, is part of the name.
  const decided = before
    .replace(/^\uFEFF/, "")
    .split("\n")
    .some((line) => /^!?\/?recordings\/? *\r?$/.test(line));
  if (decided) return;
  const lineEnd = before.includes("\r\n") ? "\r\n" : "\n";
  const separator = before === "" || before.endsWith("\n") ? "" : lineEnd;
  await appendFile(file, `${separator}recordings/${lineEnd}`);
}
