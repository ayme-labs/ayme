// Watches the source the last build of the Page Objects read, to tell the
// Session of each edit.
import { watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Queue, Stream } from "effect";

/**
 * Whether a change to the file `changed`, in a folder the last build read
 * from, is an edit of the Page Objects' source: a file that build read, or,
 * after a failed build, any file there, since the one that fixes it may be
 * new. A change the system does not name counts.
 */
export const isEdit = (
  changed: string | undefined,
  { read, failed }: { readonly read: ReadonlySet<string>; failed: boolean }
): boolean => changed === undefined || failed || read.has(changed);

/** The watch of the Page Objects' source, which each build moves to the
 * files it read. */
export function sourceWatch() {
  let watchers: FSWatcher[] = [];
  // Whether the source changed since the last build began, for a listener
  // that comes after the change.
  let edited = false;
  const listeners = new Set<() => void>();
  const close = () => {
    for (const watcher of watchers) watcher.close();
    watchers = [];
  };
  return {
    /** A build begins: it reads the source as it is from now on. */
    began: () => void (edited = false),
    /** A build that read `files` finished, `failed` or not: the watch is on
     * their folders from now on. */
    finished: (files: ReadonlySet<string>, failed: boolean) => {
      close();
      const read = new Set(files);
      for (const dir of new Set([...read].map(dirname))) {
        try {
          const watcher = watch(dir, (_event, name) => {
            if (!isEdit(name ? join(dir, name) : undefined, { read, failed }))
              return;
            edited = true;
            for (const listener of listeners) listener();
          });
          // A folder that goes away is no more source to watch.
          watcher.on("error", () => watcher.close());
          watchers.push(watcher);
        } catch {
          // A folder already gone has nothing left to edit.
        }
      }
    },
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
