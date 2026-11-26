/** Why ayme could not get a browser. */
export type BrowserErrorKind =
  /** No Playwright resolves from the project folder, or the one that does
   * cannot be loaded. */
  | "no Playwright in the project"
  /** The project's Playwright is older than the supported range. */
  | "unsupported Playwright version"
  /** The project's Playwright could not start Chromium. */
  | "browser did not start"
  /** The project's Playwright could not join the browser at an address. */
  | "address unreachable";

/**
 * The one way getting a browser fails. Its message is a sentence that names
 * what was found; a caller adds what to do about it. `kind` is for code.
 */
export class BrowserError extends Error {
  constructor(
    readonly kind: BrowserErrorKind,
    message: string
  ) {
    super(message);
  }
}
