import { rootRef } from "../../test-utils/agentCalls.testSupport";
import { afterEach, describe, expect, it } from "vitest";

import type { PomManifest } from "../../shared";
import {
  ayme as model,
  createPage,
  probeRegisteredPomMembers,
  registerCompiledPom,
} from "../../page-objects";
import { rootOf } from "../../test-utils/pomRoot.testSupport";
import { agentTools } from "../../test-utils/publication.testSupport";
import { createAyme } from "../../runtime";

/**
 * One Page State Session lives per document, so a session that has handed
 * nothing to a caller only exists in a test file of its own: any earlier test
 * would leave a caller state behind. This file therefore holds one test.
 */
describe("Change Record of the first action in Chromium", () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = "";
  });

  it("reports what a Page Object Tool changed when the caller never read the page", async () => {
    document.body.innerHTML = "<main><p>Nothing yet</p></main>";
    const page = createPage();

    class App {
      root = page.locator("main");
      announce() {
        document
          .querySelector("main")!
          .insertAdjacentHTML(
            "beforeend",
            '<div role="status">Announced</div>'
          );
      }
    }
    model({ root: rootOf })(App);
    registerCompiledPom(App, manifest);

    const runtime = createAyme({ pageFactory: () => page });
    stop = runtime.start();
    runtime.pom.register(App);
    // Its tool is published once a probe finds the Page Object available.
    await probeRegisteredPomMembers();

    const result = (await agentTools().call("App.announce", {
      ref: await rootRef("App"),
      args: {},
    })) as {
      page_changed: boolean;
      changes?: string;
    };

    expect(result.page_changed).toBe(true);
    expect(result.changes).toContain("Announced");
  });
});

const manifest: PomManifest = {
  className: "App",
  members: [{ memberName: "root", kind: "locator", access: "field" }],
  tools: [
    {
      methodName: "announce",
      toolName: "App.announce",
      description: "Announce something.",
      parameters: [],
    },
  ],
  components: [],
};
