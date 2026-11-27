/** What a Run answered: the short answer an agent reads (ADR-0070). */
export type RunAnswer = {
  /** Whether the page settled after the action; not while a new document
   * the action started still loads. */
  readonly settled: boolean;
  /** What the action returned, when it returned something. */
  readonly result?: unknown;
  /** The URL, when the action changed it. */
  readonly url?: string;
  /** How the Page Object Tree changed, as a tree. */
  readonly changes?: string;
};

/** Why a Run was refused or failed, in the sentence an agent reads today,
 * with how the Page Object Tree changed while it ran, when it changed.
 * `going` is the Run's own work when it is still under way, as after an
 * error its code left uncaught: it keeps the Tab's turn until it settles. */
export class RunError extends Error {
  constructor(
    message: string,
    readonly changes?: string,
    readonly going?: Promise<unknown>
  ) {
    super(message);
  }
}
