import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  callers,
  createAyme,
  createPage,
  type ActionResult,
  type Ayme,
} from "./index";
import { agentTools } from "./publication.testSupport";

// Runtime object seam: an agent's call through WebMCP is a `webmcp` Run,
// made here through the publication harness.

const SAVE = { target: "role=button[name='Save']" };

/** A background change no Run made, such as a toast. */
function toast(text: string) {
  document
    .querySelector("main")!
    .insertAdjacentHTML("beforeend", `<p>${text}</p>`);
}

describe("WebMCP's Caller in Chromium", () => {
  let ayme: Ayme;
  let stop: () => void;

  beforeEach(() => {
    document.body.innerHTML = "<main><button>Save</button></main>";
    ayme = createAyme({ pageFactory: () => createPage() });
    stop = ayme.start();
  });

  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  const agentCall = (name: string, input: object) =>
    agentTools().call(name, input) as Promise<ActionResult>;

  it("shares the agent's Change Record between its WebMCP calls and a Run named webmcp, apart from the app's", async () => {
    await agentCall("snapshot", {});
    await ayme.tools.run("snapshot", {});
    toast("First toast");

    await ayme.tools.run("click", SAVE, { by: callers.webmcp });
    toast("Second toast");

    const agents = await agentCall("click", SAVE);
    expect(agents.changes_before).toContain("Second toast");
    expect(agents.changes_before).not.toContain("First toast");

    const apps = await ayme.tools.run("click", SAVE);
    expect(apps.changes_before).toContain("First toast");
  });

  it("records an agent's WebMCP call as a webmcp Run, and a failed one as failed with an error result", async () => {
    const earlier = new Set(ayme.runs.list().map((run) => run.id));
    const missing = { target: "role=button[name='Delete']" };

    const saved = await agentCall("click", SAVE);
    const failed = (await agentTools().call("click", missing)) as {
      isError?: boolean;
      content: [{ text: string }];
    };

    expect(failed.isError).toBe(true);
    expect(ayme.runs.list().filter((run) => !earlier.has(run.id))).toEqual([
      expect.objectContaining({
        tool: "click",
        input: SAVE,
        by: callers.webmcp,
        status: "succeeded",
        result: saved,
      }),
      expect.objectContaining({
        tool: "click",
        input: missing,
        by: callers.webmcp,
        status: "failed",
        error: failed.content[0].text,
      }),
    ]);
  });
});
