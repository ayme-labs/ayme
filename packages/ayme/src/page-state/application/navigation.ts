/**
 * Package-internal: how a Run moves its page and reads where it is, handed in
 * rather than imported. The browser runtime moves its document with the
 * Navigation API, a Node host through the Playwright Page it was handed.
 */
export type Navigation = {
  /** The URL relative destinations resolve against. */
  baseURI(): string;
  /** The origin a destination must share with the page. */
  origin(): string;
  /**
   * Calls `navigate`, such as `goto` or `reload`, without waiting for its
   * outcome, which may be a load the page never sees. Resolves once the
   * navigation starts in the page, or once the call ends without starting
   * one.
   */
  start(navigate: () => Promise<unknown>): Promise<void>;
  /**
   * Moves one history entry with `move`, `goBack` or `goForward`. Resolves
   * with whether the page moved: once a same-document entry is current, or
   * a navigation to another document has started.
   */
  traverse(move: () => Promise<unknown>): Promise<boolean>;
};
