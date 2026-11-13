// What a recording is made of, as the session hands it to the timeline:
// plain data in the engine's words, with nothing of Playwright in it.

import type { RecordedVisit } from "../../contract";

/** Why a Visit started. The first Visit of a recording is "initial". */
export type VisitCause = RecordedVisit["cause"];

/** A page's structure at one moment, as the browser read it. */
export type PageSnapshot = {
  readonly id: string;
  readonly page: string;
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
    readonly ref: string | null;
    readonly tree: string;
    readonly ancestors?: readonly string[];
  } | null;
  /** Everything else Playwright said: the button, the modifiers and so on. */
  readonly values: Readonly<Record<string, unknown>>;
};

/** One Interaction with the snapshots around it. */
export type RecordedInteraction = {
  readonly page: string;
  readonly report: InteractionReport;
  /** The snapshot just before the input reached the page. */
  readonly before: string;
  /** The snapshot of the Settled Page after it; null when the page was gone
   * before one could be taken. */
  readonly after: string | null;
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
      readonly page: string;
      readonly url: string;
      readonly cause: VisitCause;
    }
  | { readonly kind: "snapshot"; readonly snapshot: PageSnapshot }
  | { readonly kind: "interaction"; readonly interaction: RecordedInteraction };

/**
 * A recording's trace, as the browser hands it over once it is stopped: the
 * file, and where each of the recording's snapshots is in it. A position is
 * the number the stock `playwright trace` tool takes to open that snapshot's
 * page, and it is kept as the text it is printed as.
 */
export type RecordingTrace = {
  /** An absolute path. The file is the recording's to keep or remove. */
  readonly file: string;
  /** From a snapshot's id to its position in the trace. */
  readonly positions: Readonly<Record<string, string>>;
};
