import { describe, expect, it } from "vitest";

import {
  webMcpPill,
  webMcpRow,
  webMcpToolCount,
  type PublicationStatus,
  type Tone,
} from "./connections";

// Unit tests: what the Connections pill and popover say for each status.

describe("webMcpRow", () => {
  it.each<[PublicationStatus, Tone, string, string]>([
    [
      { state: "active", message: "" },
      "ok",
      "Published",
      "3 tools published to agents in this browser.",
    ],
    [
      { state: "waiting", message: "Waiting for the WebMCP driver." },
      "ok",
      "On",
      "Publishing to agents in this browser once WebMCP is ready.",
    ],
    [
      { state: "disabled", message: "WebMCP publication is disabled." },
      "off",
      "Off",
      "For agents that live in this browser, such as an extension.",
    ],
    [
      { state: "unavailable", message: "The WebMCP driver is unavailable." },
      "warning",
      "Unavailable",
      "This browser has no WebMCP. Load the WebMCP polyfill, or turn on the browser's WebMCP flag.",
    ],
    [
      {
        state: "failed",
        message: "WebMCP publication failed: a name is taken.",
      },
      "error",
      "Failed",
      "WebMCP publication failed: a name is taken.",
    ],
    [
      { state: "disposed", message: "No ayme runtime session has started." },
      "off",
      "Stopped",
      "No ayme runtime session is running, so nothing is published.",
    ],
  ])("says %j as %s, %s", (status, tone, label, line) => {
    expect(webMcpRow(status, 3)).toMatchObject({
      tone,
      label,
      message: line,
    });
  });

  it("counts one tool as one", () => {
    expect(webMcpRow({ state: "active", message: "" }, 1).message).toBe(
      "1 tool published to agents in this browser."
    );
  });

  it("offers the option that turns it on while it is off", () => {
    expect(webMcpRow({ state: "disabled", message: "" }, 0).snippet).toBe(
      "webMCP: { enabled: true }"
    );
  });
});

describe("webMcpToolCount", () => {
  it("counts the tools WebMCP publishes, leaving out Peek tools", () => {
    expect(
      webMcpToolCount([
        { name: "ListPage.addItem", group: "pageObject" },
        { name: "snapshot", group: "agent" },
        { name: "peek.jobs", group: "peek" },
      ])
    ).toBe(2);
  });
});

describe("webMcpPill", () => {
  it("says WebMCP, with the row's tone, and names the row's state to assistive technology", () => {
    expect(
      webMcpPill(webMcpRow({ state: "failed", message: "It broke." }, 0))
    ).toEqual({ tone: "error", text: "WebMCP", label: "WebMCP failed" });
  });
});
