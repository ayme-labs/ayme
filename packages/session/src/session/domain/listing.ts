/** A Tab, as a listing names it. */
export type TabName = {
  readonly url: string;
  readonly title: string;
};

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
};

/** What a listing reads of a Tab: its name, its page's Page Object Tree as
 * text, and every Page Object Tool of that page, available or not. */
export type Listing = {
  readonly tab: TabName;
  readonly pageObjectTree: string;
  readonly tools: readonly ListedTool[];
};

/** Why a Tab could not be read, in a sentence a person reads. */
export class TabReadError extends Error {}
