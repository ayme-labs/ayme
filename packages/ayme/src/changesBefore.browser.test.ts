import { afterEach, describe, expect, it } from "vitest";
import {
  callers,
  createAyme,
  createPage,
  type ActionResult,
  type Ayme,
  type CustomTool,
  type Run,
} from "./index";
import { ACTION_RESULT_NOTE } from "./actionSequence";
import { listElementTools } from "./browserTools";
import { renderChangeRecord } from "./changeRecord";
import { getInteractionHistory } from "./pageState";
import { agentTools } from "./publication.testSupport";

// Runtime object seam: an action's result reports what changed on the page
// before it, since its Caller last received the page, apart from what the
// action itself changed.

const ADD = { target: "role=button[name='Add']" };

describe("The two parts of a Change Record, in Chromium", () => {
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

  /** The page changes on its own: nobody's action. */
  function drift(text: string) {
    document
      .querySelector("main")!
      .insertAdjacentHTML("beforeend", `<p>${text}</p>`);
  }

  const add = (by: string): Promise<ActionResult> =>
    ayme.tools.run("click", ADD, { by }) as Promise<ActionResult>;

  it("reports a change the page made on its own before the action apart from the action's own", async () => {
    start();
    const by = callers.inspector;
    await ayme.tools.run("snapshot", {}, { by });

    drift("Drifted");
    const result = await add(by);

    expect(result.page_changed).toBe(true);
    expect(result.changes_before).toContain("Drifted");
    expect(result.changes_before).not.toContain("Item 1");
    expect(result.changes).toContain("Item 1");
    expect(result.changes).not.toContain("Drifted");
  });

  it("gives no changes_before when nothing changed since the Caller last looked, and the result as before", async () => {
    start();
    const by = callers.inspector;
    await ayme.tools.run("snapshot", {}, { by });

    const result = await add(by);

    expect(Object.keys(result)).toEqual(["page_changed", "settled", "changes"]);
    expect(result).toEqual({
      page_changed: true,
      settled: true,
      changes: expect.stringContaining("Item 1"),
    });
  });

  it("reports another Caller's change under changes_before", async () => {
    start();
    await ayme.tools.run("snapshot", {}, { by: callers.inspector });

    await add(callers.aymeMcp);
    const result = await add(callers.inspector);

    expect(result.changes_before).toContain("Item 1");
    expect(result.changes_before).not.toContain("Item 2");
    expect(result.changes).toContain("Item 2");
    expect(result.changes).not.toContain("Item 1");
  });

  it("keeps a failed action's before capture in the history and leaves the Caller's cursor", async () => {
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
    const ref = structure.match(/(e\d+) button "Add"/)![1];
    const actionsBefore = getInteractionHistory(document).actions().size;

    drift("Drifted before the failure");
    await expect(ayme.tools.run("fail", { ref }, { by })).rejects.toThrow(
      "The tool failed."
    );

    // The before capture is the failed action's "before" in core's evidence.
    const history = getInteractionHistory(document);
    expect(history.actions().size).toBe(actionsBefore + 1);
    const actionId = [...history.actions().keys()].at(-1)!;
    const { unassignedChanges } =
      await history.observations.getActionEvidence(actionId);
    expect(
      unassignedChanges
        .map((change) => renderChangeRecord(change.changeTree))
        .join("\n")
    ).toContain("Drifted before the failure");
    // The cursor stayed at the snapshot: the drift is still before the next action.
    const next = await add(by);
    expect(next.changes_before).toContain("Drifted before the failure");
    expect(next.changes).toContain("Item 1");
  });

  it("answers an action that starts a full page load at once, with changes_before", async () => {
    document.body.innerHTML =
      '<main><a id="away" href="/__no-content">Away</a></main>';
    ayme = createAyme({ pageFactory: () => createPage() });
    stop = ayme.start();
    const by = callers.inspector;
    await ayme.tools.run("snapshot", {}, { by });
    drift("Drifted before leaving");

    const result = (await ayme.tools.run(
      "click",
      { target: "#away" },
      { by }
    )) as ActionResult;

    expect(result).toMatchObject({
      settled: false,
      loading: new URL("/__no-content", location.href).href,
      changes_before: expect.stringContaining("Drifted before leaving"),
    });
    expect(result.page_changed).toBe(true);
  });

  it("tells the model how an action result reports changes on Ayme's Browser Tools only", async () => {
    const highlight: CustomTool = {
      name: "highlight_element",
      description: "Highlight one element on the page.",
      async execute() {
        return null;
      },
    };
    start({ customTools: [highlight] });
    const description = (name: string) =>
      ayme.tools.list().find((tool) => tool.name === name)!.description;

    // A Browser Tool that acts on the page ends with the note; a read does not.
    expect(description("click")).toMatch(
      new RegExp(`\\. ${ACTION_RESULT_NOTE.replace(/[.()]/g, "\\$&")}$`)
    );
    expect(description("navigate")).toContain(ACTION_RESULT_NOTE);
    expect(description("generate_locator")).not.toContain(ACTION_RESULT_NOTE);
    expect(description("snapshot")).not.toContain(ACTION_RESULT_NOTE);
    // An app-authored tool is published with the description its author wrote.
    expect(description("highlight_element")).toBe(
      "Highlight one element on the page."
    );
    // The Goal Loop offers its model the Browser Tool's own description.
    expect(
      listElementTools().find(({ tool }) => tool.name === "click")!.tool
        .description
    ).not.toContain(ACTION_RESULT_NOTE);
  });

  it("gives an agent's WebMCP call the same two parts, and the before capture no Run or Interaction", async () => {
    start();
    await agentTools().call("snapshot", {});
    const runsBefore = ayme.runs.list().length;

    drift("Drifted");
    const result = (await agentTools().call("click", ADD)) as ActionResult;

    expect(result.changes_before).toContain("Drifted");
    expect(result.changes).toContain("Item 1");
    expect(result.changes).not.toContain("Drifted");
    const runs: readonly Run[] = ayme.runs.list();
    expect(runs.length).toBe(runsBefore + 1);
    expect(runs.at(-1)).toMatchObject({
      tool: "click",
      by: callers.webmcp,
      status: "succeeded",
      interactions: [expect.objectContaining({ operation: "click" })],
    });
  });
});
