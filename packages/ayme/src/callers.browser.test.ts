import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  callers,
  createAyme,
  createPage,
  RuntimeStateError,
  type ActionResult,
  type Ayme,
} from "./index";

const SAVE = { target: "role=button[name='Save']" };

/** A background change no Run made, such as a toast. */
function toast(text: string) {
  document
    .querySelector("main")!
    .insertAdjacentHTML("beforeend", `<p>${text}</p>`);
}

describe("Callers of ayme.tools.run in Chromium", () => {
  let ayme: Ayme;
  let stop: () => void;

  beforeEach(() => {
    document.body.innerHTML = "<main><button>Save</button></main>";
    let saves = 0;
    document.querySelector("button")!.addEventListener("click", () => {
      saves += 1;
      toast(`Saved ${saves}`);
    });
    ayme = createAyme({ pageFactory: () => createPage() });
    stop = ayme.start();
  });

  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  it("exports the built-in Caller names", () => {
    expect(callers).toEqual({
      app: "app",
      webmcp: "webmcp",
      aymeMcp: "ayme-mcp",
      inspector: "inspector",
    });
  });

  it("rejects an empty Caller name with an Ayme error and runs nothing", async () => {
    await expect(ayme.tools.run("click", SAVE, { by: "" })).rejects.toThrow(
      RuntimeStateError
    );
    expect(document.body.textContent).not.toContain("Saved");
  });

  it("runs as the app by default, and a named Caller shares the app's Change Record", async () => {
    await ayme.tools.run("snapshot", {});
    toast("First toast");

    const named: ActionResult = await ayme.tools.run("click", SAVE, {
      by: "support-assistant",
    });
    expect(named.changes).toContain("First toast");
    expect(named.changes).toContain("Saved 1");

    toast("Second toast");
    const byDefault = await ayme.tools.run("click", SAVE);
    expect(byDefault.changes).toContain("Second toast");
    expect(byDefault.changes).not.toContain("First toast");
    expect(byDefault.changes).toContain("Saved 2");
  });

  it("runs as a built-in Caller named by its constant", async () => {
    await expect(
      ayme.tools.run("click", SAVE, { by: callers.inspector })
    ).resolves.toMatchObject({ page_changed: true });
    expect(document.body.textContent).toContain("Saved 1");
  });
});
