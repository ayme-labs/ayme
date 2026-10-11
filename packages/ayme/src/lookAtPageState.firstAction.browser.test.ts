import { afterEach, expect, it } from "vitest";

import type { PomManifest } from "./contracts";
import { lookAtPageStateForDocument } from "./pageState";
import { probeRegisteredPomMembers, registerCompiledPom } from "./registry";
import { startAgentSession } from "./lookAtPageState.testSupport";

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
      parameters: [],
    },
  ],
} satisfies PomManifest);

let stop = () => {};
afterEach(() => {
  stop();
  document.body.innerHTML = "";
});

it("keeps the agent's first action measured from its own start after a look", async () => {
  document.body.innerHTML = `<main><button>Act</button></main>`;
  const session = await startAgentSession((runtime) => {
    runtime.pom.register(AppPage);
  });
  stop = session.stop;
  await probeRegisteredPomMembers();

  await lookAtPageStateForDocument(document);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div role="status">Saved</div>`
  );
  const result = await session.call("AppPage.noop", {});

  // The toast came before the action, so the action changed nothing.
  expect(result).toMatchObject({ page_changed: false });
});
