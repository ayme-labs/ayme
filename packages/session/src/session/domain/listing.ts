/** A Tab, as its page names it. */
export type TabName = {
  readonly url: string;
  readonly title: string;
};

/** The id a Session gives the Tab it is the `n`th to give one, as `--tab`
 * names it. */
export const tabId = (n: number): string => `t${n}`;

/** The `n` of the id `value`, when it has the form of the id a Session
 * gives a Tab, which no URL a tab shows has. */
export const tabIdNumber = (value: string): number | undefined =>
  /^t[1-9]\d*$/.test(value) ? Number(value.slice(1)) : undefined;

/** A Page Object Tool of the Tab's page, as `ayme tools` lists it. */
export type ListedTool = {
  readonly name: string;
  /** Its Agent Description, when it has one. */
  readonly description?: string;
  /** The JSON Schema of its parameters. */
  readonly parameters: unknown;
  readonly available: boolean;
  /** Its Availability Reason, when it is unavailable and has one. */
  readonly reason?: string;
  /** Present when its `@ayme.action` sets `destructive: true`. */
  readonly destructive?: true;
};

/** What a listing reads of a Tab: its name, its page's Page Object Tree as
 * text, and every Page Object Tool of that page, available or not. */
export type Listing = {
  readonly tab: TabName;
  readonly pageObjectTree: string;
  readonly tools: readonly ListedTool[];
};

/** Why a Tab could not be read, in a sentence a person reads. `going` is
 * work of a Run from the Inspector window still under way, as after an
 * error its code left uncaught: it keeps the Tab's turn until it settles. */
export class TabReadError extends Error {
  constructor(
    message: string,
    readonly going?: Promise<unknown>
  ) {
    super(message);
  }
}
