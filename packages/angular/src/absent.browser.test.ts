// The entry a build without Ayme resolves `@ayme-dev/angular` to: the names
// of the index, backed by the runtime's absent entry, so an application
// renders as it does with the real package.
import "zone.js";
import "@angular/compiler";
import {
  Component,
  createComponent,
  type ApplicationRef,
  type Type,
} from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import type { Ayme } from "@ayme-dev/ayme";
import { afterEach, expect, it, vi } from "vitest";

const { sessions } = vi.hoisted(() => ({ sessions: [] as Ayme[] }));
vi.mock("@ayme-dev/ayme/absent", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@ayme-dev/ayme/absent")>();
  return {
    ...original,
    createAyme: (...args: Parameters<typeof original.createAyme>) => {
      const session = original.createAyme(...args);
      vi.spyOn(session, "peek");
      sessions.push(session);
      return session;
    },
  };
});
import * as absent from "./absent";
import {
  injectAyme,
  injectPageObject,
  injectPeek,
  provideAyme,
  type AymeSetup,
} from "./absent";
import type * as index from "./index";

class Model {
  constructor() {
    throw new Error(
      "Page Objects are not constructed in a build without Ayme."
    );
  }
}

const apps: ApplicationRef[] = [];
async function mount<T>(component: Type<T>, options = {}) {
  const app = await createApplication({ providers: [provideAyme(options)] });
  apps.push(app);
  const ref = createComponent(component, { environmentInjector: app.injector });
  app.attachView(ref.hostView);
  app.tick();
  return {
    instance: ref.instance,
    element: ref.location.nativeElement as Element,
  };
}
afterEach(() => {
  for (const app of apps.splice(0)) app.destroy();
  sessions.length = 0;
  vi.restoreAllMocks();
});

it("exports every name of the index, with its types", async () => {
  const real = await import("./index");
  expect(Object.keys(absent).sort()).toEqual(Object.keys(real).sort());
  const surface: typeof index = absent;
  void surface;
});

it("provides an inert session with a disabled status, a Page Object of the model's class and no Peek", async () => {
  // Vitest's transform has no decorators, so the component is decorated by call.
  const Counter = Component({
    selector: "test-counter",
    template: `<output>{{ setup.webMCP.publicationStatus().state }}</output>`,
  })(
    class {
      readonly setup: AymeSetup = injectAyme();
      readonly model: object = injectPageObject(Model);
      constructor() {
        injectPeek({ count: 0 }, "counter");
      }
    }
  );
  const { instance, element } = await mount(Counter, {
    webMCP: { enabled: false },
  });
  await new Promise((resolve) => setTimeout(resolve));

  expect(element.innerHTML).toBe("<output>disabled</output>");
  expect(instance.setup.ayme.tools.list()).toEqual([]);
  expect(instance.model).toBeInstanceOf(Model);
  expect(sessions.length).toBeGreaterThan(0);
  for (const session of sessions) expect(session.peek).not.toHaveBeenCalled();
});

it("passes the provider's options to the absent runtime, which logs the publication error", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  apps.push(
    await createApplication({
      providers: [provideAyme({ webMCP: { enabled: true } })],
    })
  );
  expect(logged).toHaveBeenCalledWith(
    "Ayme was removed from this build, but setup enables WebMCP publication."
  );
});
