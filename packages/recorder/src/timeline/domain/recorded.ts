// What a recording is made of, as the session hands it to the timeline:
// plain data in the engine's words, with nothing of Playwright in it.

import type { PageId } from "@ayme-dev/core/structural-observation";

import type { EntryId, RecordedVisit } from "../../contract";
import type { PictureRef, SnapshotRef } from "./refs";

export type { PageId } from "@ayme-dev/core/structural-observation";

/** A snapshot's identity, such as "snapshot_3": the lifecycle makes it when
 * it asks for the snapshot. */
export type SnapshotId = string & { readonly __brand: "SnapshotId" };

/**
 * Where the recording's trace holds a snapshot: the number the stock
 * `playwright trace` tool takes to open its page, kept as the text it is
 * printed as. The package's `beforeSnapshotId` and `afterSnapshotId` hold
 * one, by their released names.
 */
export type TracePosition = string & { readonly __brand: "TracePosition" };

/** Why a Visit started. The first Visit of a recording is "initial". */
export type VisitCause = RecordedVisit["cause"];

/** A page's structure at one moment, as the browser read it. */
export type PageSnapshot = {
  readonly id: SnapshotId;
  readonly page: PageId;
  /** The page's address at that moment. */
  readonly url: string;
  /** When it was read, in milliseconds on the browser's monotonic clock. */
  readonly at: number;
  /** The structure, in the notation of Playwright's AI-mode snapshot. */
  readonly tree: string;
};

/** What Playwright reported about one Interaction. */
export type InteractionReport = {
  /** Playwright's name for it: "click", "check" and so on. */
  readonly type: string;
  readonly selector: string | null;
  /**
   * The report's own picture of the page at the moment of the Interaction,
   * and the target's ref in that picture. It has the shape of a snapshot,
   * but its refs are its own: they are not the refs of a `PageSnapshot`.
   * `ref` is null when the picture does not list the target; `ancestors`
   * are the refs the picture gave the target's ancestors, nearest first.
   */
  readonly target: {
    readonly ref: PictureRef | null;
    readonly tree: string;
    readonly ancestors?: readonly PictureRef[];
  } | null;
  /**
   * For a report with no picture, as of an assertion: the ref the
   * recorder's own snapshots give the element, or its nearest ancestor they
   * list, read off the page when Playwright reported it. Absent when none
   * was found.
   */
  readonly snapshotTarget?: SnapshotRef;
  /** Everything else Playwright said: the button, the modifiers and so on. */
  readonly values: Readonly<Record<string, unknown>>;
};

/**
 * How the page as it is now is asked for an element: by a selector of
 * Playwright's, by the ref the page's latest snapshot gives it, by its role
 * and its name (any name when it is empty), or by its text.
 */
export type ElementLookup =
  | { readonly by: "selector"; readonly selector: string }
  | { readonly by: "ref"; readonly ref: SnapshotRef }
  | { readonly by: "role"; readonly role: string; readonly name: string }
  | { readonly by: "text"; readonly text: string };

/** One Interaction with the snapshots around it. */
export type RecordedInteraction = {
  readonly page: PageId;
  readonly report: InteractionReport;
  /** The snapshot just before the input reached the page. */
  readonly before: SnapshotId;
  /** The snapshot of the Settled Page after it; null when the page was gone
   * before one could be taken. */
  readonly after: SnapshotId | null;
  /** When the input reached the page, on the browser's monotonic clock. */
  readonly at: number;
  /**
   * For an input the gate never holds, as typing: `before` is the latest
   * snapshot ahead of it, and the report's own picture tells how the page
   * stood at the moment of the input.
   */
  readonly beforeFromReport?: boolean;
};

/** One thing added to the timeline, in the order it happened. */
export type TimelineAddition =
  | {
      readonly kind: "visit";
      readonly page: PageId;
      readonly url: string;
      readonly cause: VisitCause;
    }
  | {
      readonly kind: "snapshot";
      readonly snapshot: PageSnapshot;
      /**
       * The page's first snapshot since a pause: where recording resumes.
       * What the page changed from the snapshot before it was not done
       * while recording, and is no change of the recording: this snapshot is
       * the new point to compare from.
       */
      readonly resumes?: boolean;
    }
  | {
      readonly kind: "interaction";
      readonly interaction: RecordedInteraction;
      /**
       * For an Interaction that may still change, as typing does while it is
       * typed: the name the session gives it. Added again under the same
       * key, it replaces the entry added before, in place, with its "before"
       * and its first picture as they were: its text from the report, and
       * what it changed up to its "after".
       */
      readonly key?: string;
    }
  /** Playwright revised the report of the Interaction added under `key`
   * after it could change no more: only its text is replaced. */
  | {
      readonly kind: "text";
      readonly key: string;
      readonly report: InteractionReport;
    }
  /** The person leaves an entry out of the recording, by its `id`. An entry
   * the timeline does not have is left alone. */
  | { readonly kind: "discard"; readonly entry: EntryId }
  /** The person puts a discarded entry back. */
  | { readonly kind: "restore"; readonly entry: EntryId };

/** A recording's trace, as the browser hands it over once it is stopped:
 * the file, and where each of the recording's snapshots is in it. */
export type RecordingTrace = {
  /** An absolute path. The file is the recording's to keep or remove. */
  readonly file: string;
  /** From a snapshot's id to its position in the trace. */
  readonly positions: Readonly<Record<SnapshotId, TracePosition>>;
};
