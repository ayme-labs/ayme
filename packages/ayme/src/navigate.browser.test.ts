import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import { createPage } from "./browserPage";
import type { GoalLoopDecisionFunction } from "./goalLoop";
import { createAyme, type Ayme } from "./runtime";
import { synchronizeWebMcpTools } from "./webMcp";

// The test server answers `/__no-content` with 204 (vitest.browser.config.ts),
// so a load starts and is then dropped: the test document stays, and what the
// tool answered can be read.
const NO_CONTENT = new URL("/__no-content", location.href).href;

type PublishedTool = {
  name: string;
  execute(input: unknown): Promise<unknown>;
};

describe("the navigate tool, in Chromium", () => {
  let ayme: Ayme;
  let published: Map<string, PublishedTool>;
  let stop: () => void;
  let disposePublication: () => void;
  let listening: AbortController;
  const start = location.href;

  beforeEach(async () => {
    document.body.innerHTML = `<main><h1>Start page</h1></main>`;
    listening = new AbortController();
    const { signal } = listening;
    const main = document.querySelector("main")!;
    // The app's router: it takes over navigations to /routes/ and renders
    // the route after a moment, and shows a section when the fragment names it.
    navigation.addEventListener(
      "navigate",
      (event) => {
        const { pathname } = new URL(event.destination.url);
        if (!event.canIntercept || !pathname.startsWith("/routes/")) return;
        event.intercept({
          async handler() {
            await new Promise((resolve) => setTimeout(resolve, 50));
            main.querySelector("h1")!.textContent = `Route ${pathname}`;
          },
        });
      },
      { signal }
    );
    window.addEventListener(
      "hashchange",
      () => main.append(`Section ${location.hash}`),
      { signal }
    );
    ayme = createAyme({
      pageFactory: () => createPage({ actionTimeout: 500 }),
      goalLoop: choosing("navigate"),
    });
    stop = ayme.start();
    published = new Map();
    disposePublication = (
      await synchronizeWebMcpTools({
        async registerTool(tool: PublishedTool) {
          published.set(tool.name, tool);
        },
      })
    ).dispose;
    await call("snapshot", {});
  });

  afterEach(() => {
    listening.abort();
    disposePublication();
    stop();
    history.replaceState(null, "", start);
    document.body.innerHTML = "";
  });

  /** Call a published tool as the calling agent. */
  function call(name: string, input: unknown) {
    const tool = published.get(name);
    if (!tool) throw new Error(`Tool ${name} was not published.`);
    return tool.execute(input);
  }

  it("is published as a Browser Tool", () => {
    expect(ayme.tools.list()).toContainEqual(
      expect.objectContaining({ name: "navigate", group: "browser" })
    );
  });

  it.each([
    ["a path", "/routes/settings"],
    ["a URL on the page's origin", new URL("/routes/settings", location.href)],
  ])(
    "answers with the route's Change Record when a router takes over %s",
    async (_kind, url) => {
      await expect(call("navigate", { url: String(url) })).resolves.toEqual({
        page_changed: true,
        settled: true,
        changes: expect.stringContaining("Route /routes/settings"),
      });
      expect(location.pathname).toBe("/routes/settings");
    }
  );

  it("answers with a Change Record when only the fragment changes", async () => {
    await expect(call("navigate", { url: "#details" })).resolves.toEqual({
      page_changed: true,
      settled: true,
      changes: expect.stringContaining("Section #details"),
    });
    expect(location.hash).toBe("#details");
  });

  it("answers at once with the loading URL when a full page load starts", async () => {
    await expect(call("navigate", { url: "/__no-content" })).resolves.toEqual({
      page_changed: false,
      settled: false,
      loading: NO_CONTENT,
      next: `The page is loading ${NO_CONTENT}. Call snapshot next to read the new page.`,
    });
  });

  /** The answer an agent gets for a call that failed with `text`. */
  const failure = (text: string) => ({
    content: [{ type: "text", text }],
    isError: true,
  });

  it.each([
    ["another origin", "https://example.com/sign-in"],
    ["an unsupported protocol", "javascript:alert(1)"],
  ])("refuses a URL on %s", async (_kind, url) => {
    await expect(call("navigate", { url })).resolves.toEqual(
      failure(
        `ToolInputError: Cannot navigate to "${url}": it is not on the page's own origin, ${location.origin}. Leaving the origin would lose the connection to this page; navigate to a path or a URL on ${location.origin} instead.`
      )
    );
    expect(location.href).toBe(start);
  });

  it("refuses an invalid URL with the browser Page's error", async () => {
    await expect(call("navigate", { url: "http://" })).resolves.toEqual(
      failure("page.goto: Cannot navigate to invalid URL")
    );
    expect(location.href).toBe(start);
  });

  it("is an operation the Goal Loop may choose", async () => {
    await expect(
      call("goal", { goal: "open the settings", maxSteps: 1 })
    ).resolves.toMatchObject({
      reason: "needs_value",
      needs: { tool: "navigate", parameters: ["url"] },
    });
  });
});

/** A decision function that chooses `operation` at every step. */
function choosing(operation: string): GoalLoopDecisionFunction {
  return async (request: DecisionRequest): Promise<DecisionResponse> => ({
    model: request.model,
    answers: {
      operation: { type: "choice", choice: operation, confidence: 1 },
      goal_met: { type: "noul", noul: 0.1 },
    },
  });
}
