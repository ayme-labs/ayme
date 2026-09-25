import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { createPage, type AymePage, type CreatePageOptions } from "./index";
import { registerCompiledPom } from "./registry";
import { createRuntimeSession } from "./runtime";

describe("createPage from the public entry in Chromium", () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = "";
  });

  it("returns the page type the runtime session uses", () => {
    expectTypeOf(createPage()).toEqualTypeOf<AymePage>();
    expectTypeOf<CreatePageOptions>().toEqualTypeOf<{
      testIdAttribute?: string;
      actionTimeout?: number;
      navigationTimeout?: number;
    }>();
  });

  it("drives the runtime with a caller-created page whose actionTimeout bounds a click that cannot complete", async () => {
    document.body.innerHTML = `<main><button disabled>Save</button></main>`;
    const page = createPage({ actionTimeout: 300 });
    class App {
      constructor(readonly page: AymePage) {}
      save() {
        return this.page.getByRole("button", { name: "Save" }).click();
      }
    }
    registerCompiledPom(App, {
      className: "App",
      components: [],
      members: [],
      tools: [],
    });
    // The page is the session's positional argument today; #120 turns it into
    // the `page` factory option.
    const runtime = createRuntimeSession(page);
    stop = runtime.start();
    const app = runtime.construct(App);
    expect(app.page).toBe(page);

    const started = performance.now();
    await expect(app.save()).rejects.toThrow("Timeout 300ms exceeded");
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(5_000);
  });
});
