import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { renderPart } from "../renderPart";
import { WebMcpStatus as WebMcpStatusPart } from "../testing";
import { WebMcpStatus, type PublicationStatus } from "./WebMcpStatus";

// Component tests: the WebMCP status line rendered alone with a fixture
// publication status, read through its page object.

const page = createPage();
const statusLine = new WebMcpStatusPart(page.locator(":root"));
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

function renderStatus(status: PublicationStatus) {
  unmounts.push(renderPart(<WebMcpStatus status={status} />));
}

it("is hidden while WebMCP publication is active", async () => {
  renderStatus({ state: "active", message: "Published 3 tools." });

  await expect.poll(() => statusLine.root.count()).toBe(0);
});

it.each([
  [
    "disabled",
    "",
    "WebMCP publishing is off, so agents can't call these tools. Set publish: true in aymeWebMcp() for the dev server.",
  ],
  [
    "waiting",
    "Waiting for the WebMCP driver.",
    "Waiting for WebMCP: agents can call these tools once it's ready.",
  ],
  [
    "unavailable",
    "The WebMCP driver is unavailable.",
    "This browser has no WebMCP, so agents can't call these tools. Load the WebMCP polyfill, or turn on the browser's WebMCP flag.",
  ],
  [
    "failed",
    'Cannot publish the Ref Tool "click": another published tool already uses that name.',
    'WebMCP publishing failed: Cannot publish the Ref Tool "click": another published tool already uses that name.',
  ],
  [
    "disposed",
    "The Ayme runtime was disposed.",
    "No Ayme runtime session is running, so nothing is published.",
  ],
] as const)(
  "says why agents can't call the tools when publication is %s",
  async (state, message, text) => {
    renderStatus({ state, message });

    await expect.poll(() => statusLine.root.textContent()).toBe(text);
  }
);
