import { afterEach, expect, it } from "vitest";

import type { PomManifest } from "./contracts";
import { peekPageStateForDocument } from "./pageState";
import { probeRegisteredPomMembers, registerCompiledPom } from "./registry";
import { startAgentSession } from "./peekPageState.testSupport";

// Its own file: the agent's first action must be the document's first
// recorded observation, and each browser test file gets its own document.

class AppPage {
  noop() {}
}

registerCompiledPom(AppPage, {
  className: "AppPage",
  members: [],
  components: [],
  tools: [
    {
      methodName: "noop",
      toolName: "AppPage.noop",
      description: "Do nothing.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      parameters: [],
    },
  ],
} satisfies PomManifest);

let stop = () => {};
afterEach(() => {
  stop();
  document.body.innerHTML = "";
});

it("keeps the agent's first action measured from its own start after a peek", async () => {
  document.body.innerHTML = `<main><button>Act</button></main>`;
  const session = await startAgentSession((runtime) => {
    runtime.register(AppPage, runtime.construct(AppPage));
  });
  stop = session.stop;
  await probeRegisteredPomMembers();

  await peekPageStateForDocument(document);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div role="status">Saved</div>`
  );
  const result = await session.call("AppPage.noop", {});

  // The toast came before the action, so the action changed nothing.
  expect(result).toMatchObject({ page_changed: false });
});
