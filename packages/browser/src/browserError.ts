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
  /** Whether Playwright gave up at its timeout, which a browser that never
   * answers makes it do, and a refused connection does not. */
  readonly timedOut: boolean;

  constructor(
    readonly kind: BrowserErrorKind,
    message: string,
    { timedOut = false }: { readonly timedOut?: boolean } = {}
  ) {
    super(message);
    this.timedOut = timedOut;
  }
}
