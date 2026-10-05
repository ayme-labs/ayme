import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPage } from "./browserPage";
import { operations, publishTools } from "./publication.testSupport";
import { createAyme, type Ayme } from "./runtime";
import { toolFailure } from "./toolFailure.testSupport";

// The test server answers `/__no-content` with 204 (vitest.browser.config.ts),
// so a load starts and is then dropped: the test document stays, and what the
// tool answered can be read.
const NO_CONTENT = new URL("/__no-content", location.href).href;

/** The error for a URL that is not on the test page's origin. */
const otherOrigin = (url: string) =>
  toolFailure(
    `ToolInputError: Cannot navigate to "${url}": it is not on the page's own origin, ${location.origin}. Leaving the origin would lose the connection to this page; navigate to a path or a URL on ${location.origin} instead.`
  );

/** The error for a URL whose protocol the tool does not open. */
const unsupportedProtocol = (url: string, protocol: string) =>
  toolFailure(
    `ToolInputError: Cannot navigate to "${url}": the protocol ${protocol} is not supported.`
  );

describe("the navigate tool, in Chromium", () => {
  let ayme: Ayme;
  let call: (name: string, input: unknown) => Promise<unknown>;
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
      goalLoop: operations(["navigate"]),
    });
    stop = ayme.start();
    ({ call, dispose: disposePublication } = await publishTools());
    await call("snapshot", {});
  });

  afterEach(() => {
    listening.abort();
    disposePublication();
    stop();
    history.replaceState(null, "", start);
    document.body.innerHTML = "";
  });

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

  it("opens a relative URL against the document's base URL", async () => {
    // The test server answers every path under /__no-content/ with 204 too.
    const base = document.createElement("base");
    base.href = "/__no-content/";
    document.head.append(base);
    try {
      const loading = new URL("/__no-content/settings", location.href).href;
      await expect(call("navigate", { url: "settings" })).resolves.toEqual({
        page_changed: false,
        settled: false,
        loading,
        next: `The page is loading ${loading}. Call snapshot next to read the new page.`,
      });
    } finally {
      base.remove();
    }
  });

  it("refuses a URL on another origin", async () => {
    const url = "https://example.com/sign-in";
    await expect(call("navigate", { url })).resolves.toEqual(otherOrigin(url));
    expect(location.href).toBe(start);
  });

  it("refuses an unsupported protocol", async () => {
    const url = "javascript:alert(1)";
    await expect(call("navigate", { url })).resolves.toEqual(
      unsupportedProtocol(url, "javascript:")
    );
    expect(location.href).toBe(start);
  });

  it("refuses a blob URL on the page's own origin", async () => {
    const url = URL.createObjectURL(new Blob(["<p>Blob page</p>"]));
    try {
      await expect(call("navigate", { url })).resolves.toEqual(
        unsupportedProtocol(url, "blob:")
      );
      expect(location.href).toBe(start);
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  it("refuses an invalid URL with the browser Page's error", async () => {
    await expect(call("navigate", { url: "http://" })).resolves.toEqual(
      toolFailure("page.goto: Cannot navigate to invalid URL")
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

describe("the navigate tool with a router function, in Chromium", () => {
  let call: (name: string, input: unknown) => Promise<unknown>;
  let stop: () => void;
  let disposePublication: () => void;
  let heading: HTMLHeadingElement;
  // What the app's router was asked to open; it lives only in this document.
  let routed: string[];
  let route: (url: string) => Promise<unknown>;
  const start = location.href;

  beforeEach(async () => {
    document.body.innerHTML = `<main><h1>Start page</h1></main>`;
    heading = document.querySelector("h1")!;
    routed = [];
    // The app's client router: it moves the URL in the document, renders
    // the route after a moment and, like many routers, resolves to a value.
    route = async (url) => {
      history.pushState(null, "", url);
      await new Promise((resolve) => setTimeout(resolve, 50));
      heading.textContent = `Route ${new URL(url).pathname}`;
      return new URL(url).pathname;
    };
    stop = createAyme({
      pageFactory: () => createPage({ actionTimeout: 500 }),
      navigate: (url) => {
        routed.push(url);
        return route(url);
      },
    }).start();
    ({ call, dispose: disposePublication } = await publishTools());
    await call("snapshot", {});
  });

  afterEach(() => {
    disposePublication();
    stop();
    history.replaceState(null, "", start);
    document.body.innerHTML = "";
  });

  it.each([
    ["a path", "/app/settings"],
    ["a URL on the page's origin", new URL("/app/settings", location.href)],
  ])(
    "opens %s through the router and answers with the route's Change Record",
    async (_kind, url) => {
      await expect(call("navigate", { url: String(url) })).resolves.toEqual({
        page_changed: true,
        settled: true,
        changes: expect.stringContaining("Route /app/settings"),
      });
      expect(routed).toEqual([new URL("/app/settings", location.href).href]);
      expect(location.pathname).toBe("/app/settings");
      // The document was not replaced: the page shows the route in the same
      // element.
      expect(heading.isConnected).toBe(true);
    }
  );

  it("keeps the router's state across navigations", async () => {
    await call("navigate", { url: "/app/settings" });
    await expect(call("navigate", { url: "profile" })).resolves.toEqual({
      page_changed: true,
      settled: true,
      changes: expect.stringContaining("Route /app/profile"),
    });
    expect(routed).toEqual([
      new URL("/app/settings", location.href).href,
      new URL("/app/profile", location.href).href,
    ]);
  });

  it("answers at once with the loading URL when the router starts a full page load", async () => {
    route = async (url) => location.assign(url);
    await expect(call("navigate", { url: "/__no-content" })).resolves.toEqual({
      page_changed: false,
      settled: false,
      loading: NO_CONTENT,
      next: `The page is loading ${NO_CONTENT}. Call snapshot next to read the new page.`,
    });
    expect(routed).toEqual([NO_CONTENT]);
  });

  it("fails the call when the router rejects", async () => {
    route = async () => {
      throw new Error("No route matches /app/missing.");
    };
    await expect(call("navigate", { url: "/app/missing" })).resolves.toEqual(
      toolFailure("No route matches /app/missing.")
    );
  });

  it("refuses a URL on another origin without calling the router", async () => {
    const url = "https://example.com/sign-in";
    await expect(call("navigate", { url })).resolves.toEqual(otherOrigin(url));
    expect(routed).toEqual([]);
    expect(location.href).toBe(start);
  });
});
