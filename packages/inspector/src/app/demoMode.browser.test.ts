import { afterEach, expect, it, vi } from "vitest";
import { createAyme, type AymePage } from "@ayme-dev/ayme";
import { registerCompiledPom } from "@ayme-dev/ayme/internal";

import { mountInspector } from "./mountInspector";
import { getInspectorTrace } from "../runs";

// The Inspector's demo mode on a real page: an agent's call, run through the
// session's tools, pauses and shows its click cue only while demo is on.
// setTimeout is fake, so the pause is measured in fake time, never
// wall-clock; animation frames stay real for the click's stability check.

class Toolbar {
  constructor(readonly page: AymePage) {}
  async go() {
    await this.page.getByRole("button", { name: "Go" }).click();
  }
}

const manifest: Parameters<typeof registerCompiledPom>[1] = {
  className: "Toolbar",
  components: [],
  members: [],
  tools: [
    {
      methodName: "go",
      toolName: "Toolbar.go",
      description: "Go.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      parameters: [],
    },
  ],
};

const disposals: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/**
 * Mounts the Inspector, starts a session with the Toolbar's tool and calls
 * it through the session's tools, the path an agent's call takes. Returns
 * the call, and the clicks and click cues the page has seen so far.
 */
function callTool({ demo }: { demo: boolean }) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  document.body.innerHTML = "<button>Go</button>";
  let clicks = 0;
  let cues = 0;
  document.querySelector("button")!.addEventListener("click", () => {
    clicks += 1;
  });
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node instanceof HTMLElement && "demoClickCue" in node.dataset)
          cues += 1;
  });
  observer.observe(document.body, { childList: true });
  registerCompiledPom(Toolbar, manifest);
  const inspector = mountInspector({ demo });
  const runtime = createAyme();
  runtime.pom.register(Toolbar);
  const stop = runtime.start();
  disposals.push(() => {
    stop();
    runtime.pom.unregister(Toolbar);
    inspector.dispose();
    observer.disconnect();
  });
  return {
    call: runtime.tools.run("Toolbar.go", {}),
    clicks: () => clicks,
    cues: () => cues,
  };
}

/**
 * Moves fake time in 10 ms steps, with a real animation frame after each,
 * until `done`. Returns how much fake time that took.
 */
async function pumpUntil(done: () => boolean) {
  let elapsed = 0;
  while (!done()) {
    if (elapsed >= 5_000) throw new Error("Still not done after 5 s.");
    await vi.advanceTimersByTimeAsync(10);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    elapsed += 10;
  }
  return elapsed;
}

/** Runs `callTool` to the end; returns the fake time until its click. */
async function untilClicked(demo: boolean) {
  const { call, clicks, cues } = callTool({ demo });
  let settled = false;
  void call.finally(() => (settled = true));
  const elapsed = await pumpUntil(() => clicks() === 1);
  await pumpUntil(() => settled);
  await call;
  return { elapsed, cues: cues() };
}

it("runs an agent's call without a pause or a click cue when demo is off", async () => {
  const { elapsed, cues } = await untilClicked(false);

  expect(elapsed).toBeLessThan(500);
  expect(cues).toBe(0);
  // The Runs view still records it.
  expect(getInspectorTrace().map(({ operation }) => operation)).toEqual([
    "click",
  ]);
});

it("pauses before an agent's call and shows its click cue when demo is on", async () => {
  const { elapsed, cues } = await untilClicked(true);

  expect(elapsed).toBeGreaterThanOrEqual(500);
  expect(cues).toBe(1);
});
