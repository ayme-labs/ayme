import { afterEach, describe, expect, it } from "vitest";
import {
  callers,
  createAyme,
  createPage,
  type Ayme,
  type CustomTool,
} from "./index";

// Runtime object seam: every Caller name reads its Change Records from its
// own cursor, the page that Caller last received, through `ayme.tools.run`.

const ADD = { target: "role=button[name='Add']" };

type ActionResultShape = {
  page_changed: boolean;
  changes_before?: string;
  changes?: string;
};

describe("Change Record cursors, in Chromium", () => {
  let ayme: Ayme;
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = "";
  });

  /** A page whose Add button appends "Item N" on each click. */
  function start(options: Parameters<typeof createAyme>[0] = {}) {
    document.body.innerHTML = "<main><button>Add</button></main>";
    let added = 0;
    document.querySelector("button")!.addEventListener("click", () => {
      document
        .querySelector("main")!
        .insertAdjacentHTML("beforeend", `<p>Item ${++added}</p>`);
    });
    ayme = createAyme({ pageFactory: () => createPage(), ...options });
    stop = ayme.start();
  }

  /** The page changes on its own: nobody's action, nobody's cursor. */
  function drift(text: string) {
    document
      .querySelector("main")!
      .insertAdjacentHTML("beforeend", `<p>${text}</p>`);
  }

  async function add(by?: string): Promise<ActionResultShape> {
    return (await ayme.tools.run(
      "click",
      ADD,
      by === undefined ? undefined : { by }
    )) as ActionResultShape;
  }

  it("reads each Caller's Change Record from the page that Caller last received", async () => {
    start();

    const first = await add(callers.inspector);
    const second = await add(callers.aymeMcp);
    const third = await add(callers.inspector);

    expect(first.changes).toContain("Item 1");
    // The second Caller had received nothing: its record covers the first
    // Caller's change too, before its own.
    expect(second.changes_before).toContain("Item 1");
    expect(second.changes).toContain("Item 2");
    // The first Caller's record starts at its own last page: what the other
    // Caller changed meanwhile is in it, what it did itself is not.
    expect(third.changes_before).not.toContain("Item 1");
    expect(third.changes_before).toContain("Item 2");
    expect(third.changes).toContain("Item 3");
  });

  it("reads from the app's cursor by default, gives a named Caller its own, and shares one between Runs under one name", async () => {
    start();

    const byApp = await add();
    const named = await add("support-assistant");
    const namedAgain = await add("support-assistant");
    const byAppAgain = await add();

    expect(byApp.changes).toContain("Item 1");
    expect(named.changes_before).toContain("Item 1");
    expect(named.changes).toContain("Item 2");
    // The second Run under the name starts where the first left it.
    expect(namedAgain.changes_before).toBeUndefined();
    expect(namedAgain.changes).toContain("Item 3");
    expect(byAppAgain.changes_before).not.toContain("Item 1");
    for (const item of ["Item 2", "Item 3"])
      expect(byAppAgain.changes_before).toContain(item);
    expect(byAppAgain.changes).toContain("Item 4");
  });

  it("moves a Caller's cursor to its snapshot and to the Settled Page of its action, and leaves it after a failed one", async () => {
    const failing: CustomTool = {
      name: "fail",
      description: "Fails.",
      async execute() {
        throw new Error("The tool failed.");
      },
    };
    start({ customTools: [failing] });
    const by = callers.inspector;

    const { structure } = await ayme.tools.run("snapshot", {}, { by });
    expect(structure).toContain("Add");
    drift("Drifted after the snapshot");
    const first = await add(by);
    // The snapshot moved the cursor: the drift since is in the record.
    expect(first.changes_before).toContain("Drifted after the snapshot");
    expect(first.changes).toContain("Item 1");

    drift("Drifted after the action");
    const ref = structure.match(/(e\d+) button "Add"/)?.[1];
    await expect(ayme.tools.run("fail", { ref }, { by })).rejects.toThrow(
      "The tool failed."
    );
    const second = await add(by);
    // The action moved the cursor to its Settled Page; the failed one did not
    // move it past the drift.
    expect(second.changes_before).not.toContain("Item 1");
    expect(second.changes_before).toContain("Drifted after the action");
    expect(second.changes).toContain("Item 2");
  });
});
