import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type { RecordingTrace } from "../domain";
import type { Timeline } from "../domain/timeline";

/**
 * Writes a timeline as a Recording Package where the released recorder
 * keeps its recordings, in the project:
 *
 *     .ayme/recordings/<recordingId>/package.yaml
 *     .ayme/recordings/<recordingId>/trace.zip   when the recording has one
 *     .ayme/recordings/latest.yaml      the same text as the package
 *     .ayme/.gitignore                  when the project has none
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
      tracePath: trace ? `.ayme/recordings/${recordingId}/trace.zip` : null,
    },
    trace?.positions
  );
  if (text === null) return null;
  await ignoreWhatIsKept(join(options.projectDir, ".ayme"));
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
    if (trace) await copyFile(trace.file, join(temporaryFolder, "trace.zip"));
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

/**
 * Keeps `.ayme` out of the project's commits, as the released recorder does:
 * a `.gitignore` there lists the recordings folder, where the recorder also
 * keeps its temporary files, and itself. A project's own file is never
 * overwritten, nor added to.
 */
async function ignoreWhatIsKept(ayme: string): Promise<void> {
  await mkdir(ayme, { recursive: true });
  await writeFile(join(ayme, ".gitignore"), "recordings/\n.gitignore\n", {
    flag: "wx",
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}

/** Where the trace of a recording is, or why it cannot be had. */
export type TraceLookup =
  | { readonly kind: "found"; readonly file: string }
  | { readonly kind: "missing"; readonly reason: string };

/**
 * The trace of the latest recording, for `latest`, or of the recording with
 * this id. The package says where its trace is, relative to the project.
 */
export async function findTrace(
  projectDir: string,
  recording: string
): Promise<TraceLookup> {
  const recordings = join(projectDir, ".ayme", "recordings");
  const latest = recording === "latest";
  const text = await readFile(
    join(recordings, latest ? "latest.yaml" : join(recording, "package.yaml")),
    // Stryker disable next-line StringLiteral: equivalent, since without an encoding the file is read as bytes, in which the search below finds the same text
    "utf8"
  ).catch(() => undefined);
  if (text === undefined)
    return {
      kind: "missing",
      reason: latest
        ? "No recording found in .ayme/recordings. Record a flow first."
        : `No recording "${recording}" found in .ayme/recordings.`,
    };
  /** A field of the package's head; undefined when it has no such line. */
  const field = (name: string) => {
    const value = new RegExp(`^${name}: (.*)$`, "m").exec(text)?.[1];
    return value?.trim();
  };
  const id = field("recordingId") ?? recording;
  const tracePath = field("tracePath");
  if (!tracePath || tracePath === "null")
    return { kind: "missing", reason: `Recording "${id}" has no trace.` };
  const file = join(projectDir, tracePath);
  return (await stat(file).catch(() => undefined))?.isFile()
    ? { kind: "found", file }
    : {
        kind: "missing",
        reason: `The trace of recording "${id}" is gone: ${file} is not there.`,
      };
}
