import { SUPPORTED_PLAYWRIGHT, type BrowserError } from "@ayme-dev/browser";

import { SessionStartError } from "../../session/domain";

/** Why a Session could not start, for a browser it could not get: what was
 * found, and what to do about it. */
export function sessionStartError(error: BrowserError): SessionStartError {
  switch (error.kind) {
    case "no Playwright in the project":
      return new SessionStartError(
        `${error.message} ayme uses the project's own Playwright: install it there, for example with "npm install -D @playwright/test".`
      );
    case "unsupported Playwright version":
      return new SessionStartError(
        `${error.message} ayme needs Playwright ${SUPPORTED_PLAYWRIGHT.floor} or newer: update the project's Playwright, for example with "npm install -D @playwright/test@latest".`
      );
    case "browser did not start":
      return new SessionStartError(
        `${error.message}\nIf Chromium is not installed for the project's Playwright, install it with: npx playwright install chromium`
      );
    case "address unreachable":
      return new SessionStartError(
        `${error.message}\nCheck that the browser runs and that this is the address of its DevTools protocol.${
          // Playwright's wait for the connection ends at its timeout then.
          error.timedOut
            ? " Chrome answers no new connection while a dialog is open in one of its pages: answer it, then run ayme attach again."
            : ""
        }`
      );
  }
}
