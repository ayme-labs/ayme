// Server tests of the owner and consumer API in Node. Test names cite the rows
// of the behaviour contract in docs/framework-integrations.md.
import { describe, expect, it, vi } from "vitest";
import { createAyme } from "@ayme-dev/ayme";
import { listRegisteredPoms } from "@ayme-dev/ayme/internal";

vi.mock("@ayme-dev/ayme", async (importOriginal) => {
  const original = await importOriginal<typeof import("@ayme-dev/ayme")>();
  return {
    ...original,
    createAyme: vi.fn(original.createAyme),
  };
});
import {
  Owner,
  OwnerAndPageObject,
  PageObjectUser,
  Status,
} from "./fixtures/components.js";
import type { UseAymeOptions, UseAymeResult } from "./index";

type PageFactory = NonNullable<UseAymeOptions["pageFactory"]>;
type Page = ReturnType<PageFactory>;

const pageFactory = vi.fn<PageFactory>(() => {
  throw new Error("The page factory must not run on the server.");
});
let constructions = 0;
// Server rendering must not need compiler-derived browser metadata.
class ServerModel {
  constructor(readonly page: Page) {
    constructions += 1;
  }
  increment() {
    throw new Error("Page Object actions are browser-only.");
  }
}

describe.each([false, true])(
  "server rendering with webMCP.enabled=%s",
  (enabled) => {
    it("C9: gives each render its own inert session and Page Objects", () => {
      vi.mocked(createAyme).mockClear();
      const owners: UseAymeResult[] = [];
      const pageObjects: object[] = [];
      // Svelte 5 renders when the result is read.
      const render = () =>
        Owner.render({
          options: { pageFactory, webMCP: { enabled } },
          onInit: (result) => owners.push(result),
          child: PageObjectUser,
          childProps: {
            model: ServerModel,
            onInit: (pageObject: object) => pageObjects.push(pageObject),
          },
        }).html;
      render();
      render();

      expect(createAyme).toHaveBeenCalledTimes(2);
      expect(owners[0]!.ayme === owners[1]!.ayme).toBe(false);
      for (const { ayme } of owners) {
        const state = enabled ? "waiting" : "disabled";
        expect(ayme.webMCP.publicationStatus.state).toBe(state);
      }
      expect(pageObjects).toHaveLength(2);
      for (const pageObject of pageObjects)
        expect(pageObject).toBeInstanceOf(ServerModel);
      expect(constructions).toBe(0);
      expect(pageFactory).not.toHaveBeenCalled();
      expect(listRegisteredPoms()).toHaveLength(0);
    });

    it("C10: renders the initial publication status", () => {
      const { html } = Owner.render({
        options: { webMCP: { enabled } },
        child: Status,
      });
      expect(html).toContain(`<p>${enabled ? "waiting" : "disabled"}</p>`);
    });
  }
);

it("C9: lets the owner use a Page Object in its own component", () => {
  let result: (UseAymeResult & { pageObject: object }) | undefined;
  void OwnerAndPageObject.render({
    options: { pageFactory },
    model: ServerModel,
    onInit: (value) => (result = value),
  }).html;
  expect(result?.pageObject).toBeInstanceOf(ServerModel);
  expect(constructions).toBe(0);
  expect(listRegisteredPoms()).toHaveLength(0);
});

it("C7: requires an owner for a Page Object", () => {
  expect(() => PageObjectUser.render({ model: ServerModel }).html).toThrow(
    "usePageObject requires useAyme() in an ancestor component, such as the root +layout.svelte."
  );
});
