import { BrowserError } from "@ayme-dev/browser";
import { expect, it } from "vitest";

import { sessionStartError } from "./startErrors";

it.each([
  [
    new BrowserError(
      "no Playwright in the project",
      "No Playwright is installed in /app."
    ),
    'No Playwright is installed in /app. ayme uses the project\'s own Playwright: install it there, for example with "npm install -D @playwright/test".',
  ],
  [
    new BrowserError(
      "unsupported Playwright version",
      "/app has Playwright 1.50.0."
    ),
    '/app has Playwright 1.50.0. ayme needs Playwright 1.62 or newer: update the project\'s Playwright, for example with "npm install -D @playwright/test@latest".',
  ],
  [
    new BrowserError(
      "browser did not start",
      "Playwright could not open Chromium. Executable doesn't exist"
    ),
    "Playwright could not open Chromium. Executable doesn't exist\nIf Chromium is not installed for the project's Playwright, install it with: npx playwright install chromium",
  ],
  [
    new BrowserError(
      "address unreachable",
      "Playwright could not connect to the browser at http://127.0.0.1:9333. connect ECONNREFUSED 127.0.0.1:9333"
    ),
    "Playwright could not connect to the browser at http://127.0.0.1:9333. connect ECONNREFUSED 127.0.0.1:9333\nCheck that the browser runs and that this is the address of its DevTools protocol.",
  ],
  [
    new BrowserError(
      "address unreachable",
      "Playwright could not connect to the browser at http://127.0.0.1:9333. browserType.connectOverCDP: Timeout 30000ms exceeded.",
      { timedOut: true }
    ),
    "Playwright could not connect to the browser at http://127.0.0.1:9333. browserType.connectOverCDP: Timeout 30000ms exceeded.\nCheck that the browser runs and that this is the address of its DevTools protocol. Chrome answers no new connection while a dialog is open in one of its pages: answer it, then run ayme attach again.",
  ],
])("says what was found and what to do about it: %s", (error, sentence) => {
  expect(sessionStartError(error).message).toBe(sentence);
});
