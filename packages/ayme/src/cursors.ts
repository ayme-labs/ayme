// Runtime, not publication: the Change Record cursors, beside the Run log.

import type { StructuralObservationEntry } from "@ayme-dev/core/structural-observation";
import type { Caller } from "./run";

/**
 * Where a reader of the page stands: the observation it last received, the
 * start of its next Change Record. `undefined` while it has received nothing;
 * a reader then falls back to the document's first observation.
 */
export type Cursor = {
  current(): StructuralObservationEntry | undefined;
  /** The reader received `to`: a snapshot, or the Settled Page after its action. */
  move(to: StructuralObservationEntry): void;
};

/**
 * One cursor per Caller name, created on first use, so two Callers under one
 * name share one; and forks, temporary cursors that start where another is,
 * for a reader that reads on a Caller's behalf for a while, as the Goal Loop
 * does for the length of a goal Run.
 */
export type Cursors = {
  of(by: Caller): Cursor;
  fork(from: Cursor): Cursor;
};

export function createCursors(): Cursors {
  const byCaller = new Map<Caller, Cursor>();
  const cursorAt = (start: StructuralObservationEntry | undefined): Cursor => {
    let current = start;
    return {
      current: () => current,
      move: (to) => {
        current = to;
      },
    };
  };
  return {
    of(by) {
      let cursor = byCaller.get(by);
      if (!cursor) {
        cursor = cursorAt(undefined);
        byCaller.set(by, cursor);
      }
      return cursor;
    },
    fork: (from) => cursorAt(from.current()),
  };
}

/**
 * The document's cursors. Module state is the document's: a new document
 * starts with none, as it starts with an empty Run log.
 */
export const cursors: Cursors = createCursors();
