// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createPage } from "./browserPage";

import {
  configureAymeRuntime,
  createPageRegistration,
  listRegisteredPomRoots,
  registerCompiledPom,
} from "./registry";

describe("registered Page Object roots", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("emits only explicit roots with exactly one current-document match", async () => {
    document.body.innerHTML = `
      <div class="one"></div>
      <div class="many"></div>
      <div class="many"></div>
    `;
    const page = createPage();
    configureAymeRuntime(page);

    class ExamplePage {
      readonly ignored = page.locator("body");
      readonly zero = { root: page.locator(".zero") };
      readonly one = { root: page.locator(".one") };
      readonly many = { root: page.locator(".many") };
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
    const registration = createPageRegistration(ExamplePage);

    await expect(listRegisteredPomRoots()).resolves.toEqual([
      {
        label: "ExamplePage.one",
        element: document.querySelector(".one"),
      },
    ]);

    registration.dispose();
  });
});
