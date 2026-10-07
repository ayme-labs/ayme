import type { Page } from "@playwright/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAyme, createPage, type ActionResult, type Ayme } from "./index";
import { executePublishedTool, recordPublishedToolsLate } from "./testing";

// Runtime object seam, with an agent calling through the recording WebMCP
// driver: its Runs take their turn on the same queue as the app's.

// The recording driver's helpers evaluate in the page; this test runs there.
const inPage = {
  evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
} as unknown as Page;

const SAVE = { target: "role=button[name='Save']" };

describe("WebMCP Runs on the page's queue, in Chromium", () => {
  let ayme: Ayme;
  let stop: () => void;

  beforeAll(() => recordPublishedToolsLate(inPage));

  beforeEach(async () => {
    // Each click saves a moment later, within the Settled Page's quiet
    // window. A click while a save is still pending leaves "Overlap".
    document.body.innerHTML = "<main><button>Save</button></main>";
    let pending = 0;
    let saves = 0;
    const main = document.querySelector("main")!;
    main.querySelector("button")!.addEventListener("click", () => {
      if (pending) main.insertAdjacentHTML("beforeend", "<p>Overlap</p>");
      pending += 1;
      setTimeout(() => {
        pending -= 1;
        saves += 1;
        main.insertAdjacentHTML("beforeend", `<p>Saved ${saves}</p>`);
      }, 100);
    });
    ayme = createAyme({
      pageFactory: () => createPage(),
      webMCP: { enabled: true },
    });
    stop = ayme.start();
    await expect.poll(() => ayme.webMCP.publicationStatus.state).toBe("active");
  });

  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  it("runs an agent's WebMCP call and the app's Run started at once one after the other", async () => {
    await Promise.all([
      executePublishedTool(inPage, "click", SAVE) as Promise<ActionResult>,
      ayme.tools.run("click", SAVE),
    ]);

    expect(document.body.textContent).not.toContain("Overlap");
    expect(document.body.textContent).toContain("Saved 2");
  });
});
