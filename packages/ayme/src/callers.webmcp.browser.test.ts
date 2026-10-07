import type { Page } from "@playwright/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  callers,
  createAyme,
  createPage,
  type ActionResult,
  type Ayme,
} from "./index";
import { executePublishedTool, recordPublishedToolsLate } from "./testing";

// The recording driver's helpers evaluate in the page; this test runs there.
const inPage = {
  evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
} as unknown as Page;

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

  beforeAll(() => recordPublishedToolsLate(inPage));

  beforeEach(async () => {
    document.body.innerHTML = "<main><button>Save</button></main>";
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

  const agentCall = (name: string, input: object) =>
    executePublishedTool(inPage, name, input) as Promise<ActionResult>;

  it("shares the agent's Change Record between WebMCP and a Run named webmcp, apart from the app's", async () => {
    await agentCall("snapshot", {});
    await ayme.tools.run("snapshot", {});
    toast("First toast");

    await ayme.tools.run("click", SAVE, { by: callers.webmcp });
    toast("Second toast");

    const agents = await agentCall("click", SAVE);
    expect(agents.changes).toContain("Second toast");
    expect(agents.changes).not.toContain("First toast");

    const apps = await ayme.tools.run("click", SAVE);
    expect(apps.changes).toContain("First toast");
  });
});
