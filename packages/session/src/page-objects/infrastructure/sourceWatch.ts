// Watches the source the builds of the Page Objects read, to tell the
// Session of each edit.
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  statSync,
  watch,
  type FSWatcher,
} from "node:fs";
import { dirname } from "node:path";
import { Effect, Queue, Stream } from "effect";

/** What an input was when a build read it: its content's hash, "missing"
 * when it did not exist, or a value nothing equals when it changed while
 * the build ran. */
type Stamp = string;

const MISSING = "missing";

/** What the file `path` holds now, as a stamp. */
function stampOf(path: string): Stamp {
  try {
    return createHash("sha1").update(readFileSync(path)).digest("hex");
  } catch {
    return MISSING;
  }
}

/** The stamp of `path` for a build that began at `began`: one changed since
 * then may not be what the build read, so it never matches. A file's time
 * and the clock's are a millisecond apart at most, so a file written just
 * before the build is not taken for one written during it. */
function stampSince(path: string, began: number): Stamp {
  try {
    if (statSync(path).mtimeMs > began + 1) return `changed ${Math.random()}`;
  } catch {
    return MISSING;
  }
  return stampOf(path);
}

/** The nearest folder at or above `folder` that exists now. */
function nearestFolder(folder: string): string {
  for (let at = folder; ; at = dirname(at))
    if (existsSync(at) || dirname(at) === at) return at;
}

/** The identity of `folder` now, which a folder put in its place does not
 * share. */
const identityOf = (folder: string) => {
  try {
    return statSync(folder).ino;
  } catch {
    return undefined;
  }
};

/** How long the source stays quiet after a change before the watch looks
 * for an edit: a save and a formatter's write after it, or the steps of a
 * branch switch, then make one build. Short enough that a rebuild still
 * follows a save at once to a person. */
export const QUIET_MS = 100;

/**
 * The watch of the Page Objects' source: the inputs of the last build, each
 * as it read it, and those of an earlier one a failed build did not reach,
 * since a failed build never shrinks what is watched. A file that does not
 * exist, such as an entry gone for a moment or a file an import names, is
 * watched in the nearest folder that does. Once the source was quiet for
 * `quietMs` after a change, the change is an edit when an input then
 * differs from what the build read; `checked` hears whether it was.
 */
export function sourceWatch({
  quietMs = QUIET_MS,
  checked,
}: {
  readonly quietMs?: number;
  readonly checked?: (edit: boolean) => void;
} = {}) {
  let inputs = new Map<string, Stamp>();
  // The inputs of the build under way, and when it began.
  let reading: { readonly inputs: Map<string, Stamp>; readonly began: number } =
    { inputs: new Map(), began: 0 };
  const watchers = new Map<
    string,
    { readonly watcher: FSWatcher; readonly identity: number | undefined }
  >();
  // Why a folder could not be watched, while it cannot.
  let lost: string | undefined;
  // Whether the source changed since the last build began, for a listener
  // that comes after the change.
  let edited = false;
  const listeners = new Set<() => void>();
  let quiet: ReturnType<typeof setTimeout> | undefined;

  const close = () => {
    clearTimeout(quiet);
    for (const { watcher } of watchers.values()) watcher.close();
    watchers.clear();
  };
  /** Checks for an edit once the source was quiet for `quietMs`. */
  const soon = () => {
    clearTimeout(quiet);
    quiet = setTimeout(check, quietMs);
  };
  /** Watches the folders the inputs are in, or the nearest ones that exist,
   * and no other; one replaced since it was watched is watched again. */
  const reconcile = () => {
    lost = undefined;
    const folders = new Set(
      [...inputs.keys()].map((input) => nearestFolder(dirname(input)))
    );
    for (const [folder, { watcher, identity }] of watchers)
      if (!folders.has(folder) || identityOf(folder) !== identity) {
        watcher.close();
        watchers.delete(folder);
      }
    for (const folder of folders) {
      if (watchers.has(folder)) continue;
      try {
        const watcher = watch(folder, soon);
        // A folder that goes away is watched again where its inputs would
        // be; one that cannot be is told.
        watcher.on("error", () => {
          watcher.close();
          watchers.delete(folder);
          soon();
        });
        watchers.set(folder, { watcher, identity: identityOf(folder) });
      } catch (error) {
        lost = `${folder}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  };
  /** Tells of an edit when an input differs from what its build read. */
  function check() {
    reconcile();
    const edit = [...inputs].some(([input, stamp]) => stampOf(input) !== stamp);
    checked?.(edit);
    if (!edit) return;
    edited = true;
    for (const listener of listeners) listener();
  }

  return {
    /** A build begins: it reads the source as it is from now on. */
    began: () => {
      edited = false;
      reading = { inputs: new Map(), began: Date.now() };
    },
    /** The build under way reads `path`, or would read it if it existed. */
    reads: (path: string) =>
      void reading.inputs.set(path, stampSince(path, reading.began)),
    /** The build under way finished, `failed` or not: the watch is on its
     * inputs from now on, and on those of the last one when it failed. An
     * input that changed since it was read is an edit once the source is
     * quiet. */
    finished: (failed: boolean) => {
      const read = reading.inputs;
      if (failed)
        for (const input of inputs.keys())
          if (!read.has(input))
            read.set(input, stampSince(input, reading.began));
      inputs = read;
      reconcile();
      soon();
    },
    /** Why the watch could not be kept, while it cannot: an edit there may
     * go untold. */
    lost: () => lost,
    close,
    /** Each edit, from when the stream runs, the first at once when the
     * source changed since the last build began. */
    edits: Stream.callback<void>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const listener = () => void Queue.offerUnsafe(queue, undefined);
          listeners.add(listener);
          if (edited) listener();
          return listener;
        }),
        (listener) => Effect.sync(() => listeners.delete(listener))
      )
    ),
  };
}
