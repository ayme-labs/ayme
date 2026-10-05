import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPage } from "./browserPage";
import { operations, publishTools } from "./publication.testSupport";
import { toolFailure } from "./toolFailure.testSupport";
import { createAyme, type Ayme } from "./runtime";

// The test document's first history entry: no test can go back from it.
const firstEntry = navigation.currentEntry!;

/** The operations the Goal Loop last offered its model. */
let offered: string[] = [];

describe("navigate_back, navigate_forward and reload, in Chromium", () => {
  let ayme: Ayme;
  let call: (name: string, input: unknown) => Promise<unknown>;
  let stop: () => void;
  let disposePublication: () => void;
  let listening: AbortController;

  /** The app opens `title` as a new history entry of the same document. */
  function open(title: string) {
    history.pushState({ title }, "");
    document.querySelector("h1")!.textContent = title;
  }

  beforeEach(async () => {
    document.body.innerHTML = `<main><h1>Start page</h1></main>`;
    history.replaceState({ title: "Start page" }, "");
    listening = new AbortController();
    // The app's router renders the entry the history moved to.
    window.addEventListener(
      "popstate",
      (event: PopStateEvent) => {
        document.querySelector("h1")!.textContent = (
          event.state as { title: string }
        ).title;
      },
      { signal: listening.signal }
    );
    const decide = operations(["navigate_back", "navigate_forward"]);
    ayme = createAyme({
      pageFactory: () => createPage({ actionTimeout: 500 }),
      goalLoop: (request) => {
        offered = Object.keys(
          (request.questions.operation as { criteria: object }).criteria
        );
        return decide(request);
      },
    });
    stop = ayme.start();
    ({ call, dispose: disposePublication } = await publishTools());
  });

  afterEach(async () => {
    listening.abort();
    disposePublication();
    stop();
    if (navigation.currentEntry!.key !== firstEntry.key)
      await navigation.traverseTo(firstEntry.key).finished;
    document.body.innerHTML = "";
  });

  const heading = () => document.querySelector("h1")!.textContent;

  it("reports that nothing happened when there is no entry to go back to", async () => {
    expect(navigation.canGoBack).toBe(false);
    await call("snapshot", {});
    await expect(call("navigate_back", {})).resolves.toEqual({
      result: "There is no history entry to go back to; the page did not move.",
      page_changed: false,
      settled: true,
    });
    expect(navigation.currentEntry!.key).toBe(firstEntry.key);
  });

  it("reports that nothing happened when there is no entry to go forward to", async () => {
    open("Settings");
    await call("snapshot", {});
    await expect(call("navigate_forward", {})).resolves.toEqual({
      result:
        "There is no history entry to go forward to; the page did not move.",
      page_changed: false,
      settled: true,
    });
    expect(heading()).toBe("Settings");
  });

  it("goes back and forward over the app's entries with Change Records, staying in the document", async () => {
    open("Settings");
    await call("snapshot", {});

    await expect(call("navigate_back", {})).resolves.toEqual({
      page_changed: true,
      settled: true,
      changes: expect.stringContaining("Start page"),
    });
    expect(heading()).toBe("Start page");

    await expect(call("navigate_forward", {})).resolves.toEqual({
      page_changed: true,
      settled: true,
      changes: expect.stringContaining("Settings"),
    });
    expect(heading()).toBe("Settings");
  });

  it("publishes all three as Browser Tools", () => {
    for (const name of ["navigate_back", "navigate_forward", "reload"])
      expect(ayme.tools.list()).toContainEqual(
        expect.objectContaining({ name, group: "browser" })
      );
  });

  it("offers all three to the Goal Loop, which runs them", async () => {
    open("Settings");
    await expect(
      call("goal", { goal: "go back, then forward again", maxSteps: 2 })
    ).resolves.toMatchObject({
      history: [
        { operation: "navigate_back", result: "ok", page_changed: true },
        { operation: "navigate_forward", result: "ok", page_changed: true },
      ],
    });
    expect(heading()).toBe("Settings");
    for (const name of ["navigate_back", "navigate_forward", "reload"])
      expect(offered).toContain(name);
  });
});

describe("navigate_back and navigate_forward when the browser Page fails, in Chromium", () => {
  let call: (name: string, input: unknown) => Promise<unknown>;
  let stop: () => void;
  let disposePublication: () => void;

  beforeEach(async () => {
    document.body.innerHTML = `<main><h1>Start page</h1></main>`;
    stop = createAyme({
      pageFactory: () => {
        // A browser Page whose traversal fails before any navigation starts.
        const page = createPage({ actionTimeout: 500 });
        const fail = () => Promise.reject(new Error("The browser refused."));
        return Object.assign(page, { goBack: fail, goForward: fail });
      },
    }).start();
    ({ call, dispose: disposePublication } = await publishTools());
  });

  afterEach(() => {
    disposePublication();
    stop();
    document.body.innerHTML = "";
  });

  it.each(["navigate_back", "navigate_forward"])(
    "fails %s with the browser Page's error instead of waiting forever",
    async (name) => {
      await expect(call(name, {})).resolves.toEqual(
        toolFailure("The browser refused.")
      );
      expect(navigation.currentEntry!.key).toBe(firstEntry.key);
    }
  );
});
