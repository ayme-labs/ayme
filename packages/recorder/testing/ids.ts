import type { EntryId } from "../src/contract";
import type { InputId } from "../src/session/domain";
import type {
  PageId,
  SnapshotId,
  SnapshotRef,
  TracePosition,
} from "../src/timeline/domain";

// Ids and refs as tests write them by hand, for every slice's tests.
// Test-only: only tests import this folder (docs/testing.md#test-only-code).

export const pageId = (id: string) => id as PageId;
export const snapshotId = (id: string) => id as SnapshotId;
export const inputId = (id: string) => id as InputId;
export const entryId = (id: string) => id as EntryId;
export const snapshotRefOf = (ref: string) => ref as SnapshotRef;
/** Where a trace holds each snapshot, by the snapshot's id. */
export const tracePositions = (positions: Record<string, string>) =>
  positions as Record<SnapshotId, TracePosition>;
