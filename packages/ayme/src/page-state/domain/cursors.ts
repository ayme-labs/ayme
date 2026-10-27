// Runtime, not publication: the Change Record cursors, beside the Run log.

import type { StructuralObservationEntry } from "@ayme-dev/core/structural-observation";
import type { Caller } from "../../shared";

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
 * name share one.
 */
export type Cursors = {
  of(by: Caller): Cursor;
};

export function createCursors(): Cursors {
  const byCaller = new Map<Caller, Cursor>();
  return {
    of(by) {
      let cursor = byCaller.get(by);
      if (!cursor) {
        cursor = cursorAt(undefined);
        byCaller.set(by, cursor);
      }
      return cursor;
    },
  };
}

/**
 * A fork of `from`: a temporary cursor that starts where `from` is, for a
 * reader that reads on a Caller's behalf for a while, as the Goal Loop does
 * for the length of a goal Run.
 */
export function forkCursor(from: Cursor): Cursor {
  return cursorAt(from.current());
}

function cursorAt(start: StructuralObservationEntry | undefined): Cursor {
  let current = start;
  return {
    current: () => current,
    move: (to) => {
      current = to;
    },
  };
}
