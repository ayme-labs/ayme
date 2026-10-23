// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPage } from "./browserPage";

import { rooted } from "../test-utils/pomRoot.testSupport";
import { listRegisteredPomRoots, registerCompiledPom } from "./registry";
import {
  startSession,
  type TestSession,
} from "../test-utils/session.testSupport";

describe("registered Page Object roots", () => {
  let page: ReturnType<typeof createPage>;
  let session: TestSession;
  beforeEach(() => {
    page = createPage();
    session = startSession(page);
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
        label: "ExamplePage.one",
        element: document.querySelector(".one"),
      },
    ]);
  });
});
