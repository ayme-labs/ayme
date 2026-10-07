import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  callers,
  createAyme,
  createPage,
  type ActionResult,
  type Ayme,
} from "./index";

// Runtime object seam: Runs start through `ayme.tools.run`; their order shows
// on the page and in what each Run answers.

const SAVE = { target: "role=button[name='Save']" };
const MISSING = { target: "role=button[name='Missing']" };

/** Within the Settled Page's quiet window, so an action's settle waits for it. */
const SAVE_DELAY_MS = 100;

describe("one Run at a time per page, in Chromium", () => {
  let ayme: Ayme;
  let stop: () => void;

  beforeEach(async () => {
    // Each click saves a moment later. A click while a save is still pending
    // leaves "Overlap" on the page: a Run acted before the one before it had
    // settled.
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
      }, SAVE_DELAY_MS);
    });
    ayme = createAyme({
      pageFactory: () => createPage({ actionTimeout: 500 }),
    });
    stop = ayme.start();
    // The app's Change Record starts here.
    await ayme.tools.run("snapshot", {});
  });

  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  it("runs two Runs started at once by different Callers one after the other", async () => {
    const [first, second] = (await Promise.all([
      ayme.tools.run("click", SAVE, { by: callers.inspector }),
      ayme.tools.run("click", SAVE, { by: "support-assistant" }),
    ])) as ActionResult[];

    expect(document.body.textContent).not.toContain("Overlap");
    expect(first!.changes).toContain("Saved 1");
    expect(second!.changes).toContain("Saved 2");
  });

  it("has a snapshot started during an action wait for it, with no settle wait of its own", async () => {
    let actionDoneAt = 0;
    const action = ayme.tools.run("click", SAVE).then(() => {
      actionDoneAt = performance.now();
    });
    const { structure } = await ayme.tools.run("snapshot", {});
    const readDoneAt = performance.now();
    await action;

    expect(structure).toContain("Saved 1");
    // A settle wait lasts at least the quiet window (250 ms).
    expect(readDoneAt - actionDoneAt).toBeLessThan(200);
  });

  it("releases the queue after a failing Run", async () => {
    const [failed, next] = await Promise.allSettled([
      ayme.tools.run("click", MISSING),
      ayme.tools.run("click", SAVE),
    ]);

    expect(failed.status).toBe("rejected");
    expect(next).toMatchObject({
      status: "fulfilled",
      value: { changes: expect.stringContaining("Saved 1") },
    });
  });
});
