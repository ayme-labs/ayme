import { afterEach, describe, expect, it } from "vitest";

import type { PomManifest } from "./contracts";
import { runPublished } from "./agentCalls.testSupport";
import { createPage } from "./browserPage";
import { createPageRegistration, registerCompiledPom } from "./registry";
import { createAyme } from "./runtime";
import { synchronizeWebMcpTools } from "./webMcp";

type PublishedTool = {
  name: string;
  execute(input: unknown): Promise<unknown>;
};

/**
 * One Page State Session lives per document, so a session that has handed
 * nothing to a caller only exists in a test file of its own: any earlier test
 * would leave a caller state behind. This file therefore holds one test.
 */
describe("Change Record of the first action in Chromium", () => {
  let stop: (() => void) | undefined;
  let disposePublication: (() => void) | undefined;

  afterEach(() => {
    disposePublication?.();
    disposePublication = undefined;
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
    registerCompiledPom(App, manifest);

    const runtime = createAyme({ pageFactory: () => page });
    stop = runtime.start();
    createPageRegistration(App);

    const published = new Map<string, PublishedTool>();
    const publication = await synchronizeWebMcpTools(
      {
        async registerTool(tool: PublishedTool) {
          published.set(tool.name, tool);
        },
      },
      { run: runPublished }
    );
    disposePublication = publication.dispose;

    const result = (await published.get("App.announce")!.execute({})) as {
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
};
