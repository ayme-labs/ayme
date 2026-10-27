// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPage } from "./browserPage";

import { alwaysReaches } from "../../test-utils/reach.testSupport";
import { rooted } from "../../test-utils/pomRoot.testSupport";
import { listRegisteredPomRoots, registerCompiledPom } from "./registry";
import { litePageDriver } from "./litePageDriver";
import {
  startSession,
  type TestSession,
} from "../../test-utils/session.testSupport";

describe("registered Page Object roots", () => {
  let page: ReturnType<typeof createPage>;
  let session: TestSession;
  beforeEach(() => {
    page = createPage();
    session = startSession(page, { reach: alwaysReaches() });
  });
  afterEach(() => {
    session.stop();
    document.body.innerHTML = "";
  });

  it("emits only explicit roots with exactly one current-document match", async () => {
    document.body.innerHTML = `
      <div class="one"></div>
      <div class="many"></div>
      <div class="many"></div>
    `;

    class ExamplePage {
      readonly ignored = page.locator("body");
      readonly zero = rooted(page.locator(".zero"), {});
      readonly one = rooted(page.locator(".one"), {});
      readonly many = rooted(page.locator(".many"), {});
    }
    registerCompiledPom(ExamplePage, {
      className: "ExamplePage",
      tools: [],
      members: [
        { memberName: "ignored", kind: "locator", access: "field" },
        {
          memberName: "zero",
          kind: "component",
          access: "field",
          componentClassName: "Root",
          collection: false,
        },
        {
          memberName: "one",
          kind: "component",
          access: "field",
          componentClassName: "Root",
          collection: false,
        },
        {
          memberName: "many",
          kind: "component",
          access: "field",
          componentClassName: "Root",
          collection: false,
        },
      ],
      components: [
        {
          className: "Root",
          members: [{ memberName: "root", kind: "locator", access: "field" }],
          tools: [],
        },
      ],
    });
    session.register(ExamplePage);

    await expect(listRegisteredPomRoots()).resolves.toEqual([
      {
        label: "Root",
        element: document.querySelector(".one"),
      },
    ]);
  });

  it("observes a root with the Reach of the started session, and with none of it once the session stops", async () => {
    document.body.innerHTML = '<div class="one"></div>';
    const measurePomRoot = vi.fn(async () => ({
      present: true,
      available: false,
    }));
    session.stop();
    session = startSession(page, { reach: alwaysReaches({ measurePomRoot }) });
    const root = page.locator(".one");

    await expect(litePageDriver.observeRoot(root)).resolves.toMatchObject({
      root: { present: true, available: false },
    });
    expect(measurePomRoot).toHaveBeenCalledOnce();

    session.stop();
    await litePageDriver.observeRoot(root);
    expect(measurePomRoot).toHaveBeenCalledOnce();
  });
});
