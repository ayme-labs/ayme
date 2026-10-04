import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionRequest, DecisionResponse } from "./decisionTypes";
import { createPage } from "./browserPage";
import type { GoalLoopDecisionFunction } from "./goalLoop";
import { registerCompiledPom } from "./registry";
import { createAyme, type Ayme } from "./runtime";
import { synchronizeWebMcpTools } from "./webMcp";

// The test server answers `/__no-content` with 204 and `/__redirect` with a
// 303 to it (vitest.browser.config.ts), so a load starts and is then dropped:
// the test document stays, and what the tool answered can be read.
const NO_CONTENT = new URL("/__no-content", location.href).href;
const REDIRECT = new URL("/__redirect", location.href).href;
const loadingNote = (url: string) =>
  `The page is loading ${url}. Call snapshot next to read the new page.`;

type PublishedTool = {
  name: string;
  execute(input: unknown): Promise<unknown>;
};

class Leaver {
  leave() {
    location.assign("/__no-content");
  }
}
registerCompiledPom(Leaver, {
  className: "Leaver",
  members: [],
  tools: [
    {
      methodName: "leave",
      toolName: "Leaver.leave",
      description: "Leave the page.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      parameters: [],
    },
  ],
  components: [],
});

describe("a tool call that starts a full page load, in Chromium", () => {
  let ayme: Ayme;
  let published: Map<string, PublishedTool>;
  let stop: () => void;
  let disposePublication: () => void;
  const start = location.href;

  beforeEach(async () => {
    document.body.innerHTML = `
      <main>
        <p id="toast" role="status">Saved</p>
        <a id="away" href="/__no-content">Away</a>
        <a id="section-link" href="#section">Section</a>
        <a id="route" href="/route">Route</a>
        <form method="post" action="/__redirect">
          <button>Sign in</button>
        </form>
      </main>
    `;
    document
      .querySelector("#away")!
      .addEventListener("click", () =>
        document.querySelector("#toast")!.remove()
      );
    ayme = createAyme({
      pageFactory: () => createPage({ actionTimeout: 500 }),
      customTools: [
        {
          name: "follow",
          description: "Follow a link.",
          async execute({ element }) {
            (element as HTMLElement).click();
          },
        },
      ],
      goalLoop: operations(["Leaver.leave"]),
    });
    stop = ayme.start();
    ayme.pom.register(Leaver);
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
    disposePublication();
    ayme.pom.unregister(Leaver);
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

  it("answers a click on a link to another document with the changes so far and the loading URL", async () => {
    await expect(call("click", { target: "#away" })).resolves.toEqual({
      page_changed: true,
      settled: false,
      changes: expect.stringMatching(/<removed> status: Saved/),
      loading: NO_CONTENT,
      next: loadingNote(NO_CONTENT),
    });
  });

  it("answers a redirecting form submit the same way", async () => {
    await expect(
      call("click", { target: "role=button[name='Sign in']" })
    ).resolves.toMatchObject({
      settled: false,
      loading: REDIRECT,
      next: loadingNote(REDIRECT),
    });
  });

  it("answers a Custom Tool and a Page Object Tool the same way", async () => {
    const away = (await ayme.tools.run("snapshot", {})).structure.match(
      /(e\d+) link "Away"/
    )![1]!;
    await expect(call("follow", { ref: away })).resolves.toMatchObject({
      loading: NO_CONTENT,
      next: loadingNote(NO_CONTENT),
    });
    await expect(ayme.tools.run("Leaver.leave", {})).resolves.toMatchObject({
      settled: false,
      loading: NO_CONTENT,
      next: loadingNote(NO_CONTENT),
    });
  });

  it("ends a goal with a Handover naming the loading URL", async () => {
    await expect(
      call("goal", { goal: "leave the page", maxSteps: 3 })
    ).resolves.toEqual({
      reason: "page_loading",
      next: `Leaver.leave() started loading ${NO_CONTENT}. Call snapshot next to read the new page.`,
      history: [
        {
          operation: "Leaver.leave",
          chosen: {},
          result: "ok",
          page_changed: false,
          did: "Leaver.leave()",
        },
      ],
      loading: NO_CONTENT,
    });
  });

  it("settles as before on a fragment navigation", async () => {
    const result = await call("click", { target: "#section-link" });
    expect(result).toMatchObject({ settled: true });
    expect(result).not.toHaveProperty("loading");
    expect(location.hash).toBe("#section");
  });

  // A router that renders at once finishes its navigation within the click;
  // a slower one is still in transition a task later.
  it.each([0, 50])(
    "settles as before on a navigation a router intercepts and renders in %i ms",
    async (renderMs) => {
      const router = (event: NavigateEvent) => {
        if (new URL(event.destination.url).pathname !== "/route") return;
        event.intercept({
          async handler() {
            if (renderMs)
              await new Promise((resolve) => setTimeout(resolve, renderMs));
            document.querySelector("main")!.append("Routed page");
          },
        });
      };
      navigation.addEventListener("navigate", router);
      try {
        const result = await call("click", { target: "#route" });
        expect(result).toEqual({
          page_changed: true,
          settled: true,
          changes: expect.stringContaining("Routed page"),
        });
        expect(location.pathname).toBe("/route");
      } finally {
        navigation.removeEventListener("navigate", router);
      }
    }
  );
});

/** A decision function that runs the listed operations, one per step. */
function operations(steps: string[]): GoalLoopDecisionFunction {
  let step = 0;
  return async (request: DecisionRequest): Promise<DecisionResponse> => ({
    model: request.model,
    answers: {
      operation: {
        type: "choice",
        choice: steps[Math.min(step++, steps.length - 1)]!,
        confidence: 1,
      },
      goal_met: { type: "noul", noul: 0.1 },
    },
  });
}
