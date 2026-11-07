import { afterEach, expect, it } from "vitest";

import { createPage } from "./browserPage";
import {
  listAvailablePomTools,
  probeRegisteredPomMembers,
  registerCompiledPom,
} from "./registry";
import { rooted } from "../../test-utils/pomRoot.testSupport";
import {
  startSession,
  type TestSession,
} from "../../test-utils/session.testSupport";

// A file of its own: its document's in-page module is installed by this
// test, while the document has no root element, as an init script's is.
let session: TestSession | undefined;
afterEach(() => {
  session?.stop();
  document.body.innerHTML = "";
});

it("observes a Page Object registered before the document has its root element, once the root renders", async () => {
  const html = document.documentElement;
  html.remove();
  const page = createPage();
  class Shell {
    readonly sidebar = rooted(page.locator("#sidebar"), { close() {} });
  }
  registerCompiledPom(Shell, {
    className: "Shell",
    members: [
      {
        memberName: "sidebar",
        kind: "component",
        access: "field",
        componentClassName: "Panel",
        collection: false,
      },
    ],
    tools: [],
    components: [
      {
        className: "Panel",
        members: [{ memberName: "root", kind: "locator", access: "field" }],
        tools: [
          {
            methodName: "close",
            toolName: "Panel.close",
            description: "Closes the panel.",
            parameters: [],
          },
        ],
      },
    ],
  });
  try {
    session = startSession(page);
    session.register(Shell);
    // The page runs on without a root element for a while, as it does
    // until the parser creates `<html>`.
    await probeRegisteredPomMembers();
    expect(document.documentElement).toBeNull();
    expect(listAvailablePomTools()).toEqual([]);
  } finally {
    document.append(html);
  }

  document.body.innerHTML =
    '<aside id="sidebar" style="width:240px;height:120px">Sidebar</aside>';

  await expect
    .poll(() => listAvailablePomTools().map((tool) => tool.name))
    .toEqual(["Panel.close"]);
});
