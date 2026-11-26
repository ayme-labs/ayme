import { SUPPORTED_PLAYWRIGHT, type BrowserError } from "@ayme-dev/browser";

import { RecorderStartError } from "../../session/domain";

const { floor, lastVerified } = SUPPORTED_PLAYWRIGHT;

/** The supported range, as the recorder's sentences name it. */
export const rangeText = `Playwright ${floor} or newer, and is verified on ${floor} to ${lastVerified}`;

/** Why the recorder could not start, for a browser it could not get: what
 * was found, and what to do about it. */
export function recorderStartError(error: BrowserError): RecorderStartError {
  switch (error.kind) {
    case "no Playwright in the project":
      return new RecorderStartError(
        "playwright-not-found",
        `${error.message} The recorder uses the project's own Playwright: install it there, for example with "npm install -D @playwright/test".`
      );
    case "unsupported Playwright version":
      return new RecorderStartError(
        "playwright-too-old",
        `${error.message} The recorder needs ${rangeText}: update the project's Playwright, for example with "npm install -D @playwright/test@latest".`
      );
    case "browser did not start":
    case "address unreachable":
      return new RecorderStartError("browser-unavailable", error.message);
  }
}
