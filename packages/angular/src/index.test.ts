// @vitest-environment jsdom
import {
  createEnvironmentInjector,
  Injector,
  runInInjectionContext,
  type EnvironmentInjector,
  type EnvironmentProviders,
} from "@angular/core";
import {
  listRegisteredPoms,
  registerCompiledPom,
} from "@ayme-dev/ayme/internal";
import { afterEach, expect, it, vi } from "vitest";
import {
  injectAyme,
  injectPageObject,
  provideAyme,
  type AymeOptions,
} from "./index";

type Page = ReturnType<NonNullable<AymeOptions["pageFactory"]>>;
const page = {} as Page;
const pageFactory = () => page;
class Model {
  constructor(readonly page: Page) {}
}
registerCompiledPom(Model, {
  className: "Model",
  components: [],
  members: [],
  tools: [],
});

const injectors: EnvironmentInjector[] = [];
function environment(
  providers: EnvironmentProviders[] = [],
  parent = Injector.NULL as EnvironmentInjector
) {
  const injector = createEnvironmentInjector(providers, parent);
  injectors.push(injector);
  return injector;
}
afterEach(() => {
  for (const injector of injectors.splice(0).reverse())
    // Angular 19 does not declare `destroyed` on EnvironmentInjector.
    if (!(injector as { destroyed?: boolean }).destroyed) injector.destroy();
  vi.useRealTimers();
});

it("starts Ayme with the environment and registers a Page Object until its injector is destroyed", () => {
  const root = environment([provideAyme({ pageFactory })]);
  const scope = environment([], root);

  const model = runInInjectionContext(scope, () => injectPageObject(Model));

  expect(model).toBeInstanceOf(Model);
  expect(model.page).toBe(page);
  expect(listRegisteredPoms().map((pom) => pom.instance)).toEqual([model]);
  scope.destroy();
  expect(listRegisteredPoms()).toEqual([]);
});

it("returns { ayme, webMCP } with publication disabled by default, and stops Ayme with the environment", async () => {
  const root = environment([provideAyme({ pageFactory })]);
  const setup = runInInjectionContext(root, injectAyme);

  expect(Object.keys(setup)).toEqual(["ayme", "webMCP"]);
  expect(Object.keys(setup.webMCP)).toEqual([
    "publicationStatus",
    "retryPublication",
  ]);
  expect(setup.webMCP.publicationStatus()).toEqual({
    state: "disabled",
    message: "WebMCP publication is disabled.",
  });
  root.destroy();
  expect(setup.ayme.webMCP.publicationStatus.state).toBe("disposed");
  await expect(
    setup.ayme.tools.run("goal", { goal: "goal", maxSteps: 1 })
  ).rejects.toThrow("the Ayme runtime session is not started.");
});

// The runtime waits 2 s for a WebMCP driver before reporting `unavailable`.
const pastDriverWait = 2_100;

it("updates the status signal as publication changes", async () => {
  vi.useFakeTimers();
  const root = environment([
    provideAyme({ pageFactory, webMCP: { enabled: true } }),
  ]);
  const { webMCP } = runInInjectionContext(root, injectAyme);

  expect(webMCP.publicationStatus().state).toBe("waiting");
  // No WebMCP driver appears within the runtime's wait.
  await vi.advanceTimersByTimeAsync(pastDriverWait);
  expect(webMCP.publicationStatus().state).toBe("unavailable");
  const retry = webMCP.retryPublication();
  expect(webMCP.publicationStatus().state).toBe("waiting");
  await vi.advanceTimersByTimeAsync(pastDriverWait);
  await retry;
  expect(webMCP.publicationStatus().state).toBe("unavailable");
});

it("rejects provideAyme beneath another provideAyme", () => {
  const root = environment([provideAyme({ pageFactory })]);

  expect(() => environment([provideAyme({ pageFactory })], root)).toThrow(
    "provideAyme cannot be nested beneath another Ayme runtime owner."
  );
});

it("rejects injectAyme and injectPageObject without provideAyme above", () => {
  const root = environment();

  for (const inject of [
    injectAyme,
    () => injectPageObject(Model),
  ] as (() => unknown)[])
    expect(() => runInInjectionContext(root, inject)).toThrow(
      "Ayme requires provideAyme() in an ancestor injector."
    );
});

it("rejects injectAyme and injectPageObject outside an injection context", () => {
  for (const inject of [
    injectAyme,
    () => injectPageObject(Model),
  ] as (() => unknown)[])
    expect(inject).toThrow(/NG0203/);
});

it("keeps one owner per document across root injectors, as two applications have, and allows a new one after the first is destroyed", () => {
  const first = environment([provideAyme({ pageFactory })]);

  expect(() => environment([provideAyme({ pageFactory })])).toThrow(
    "The Ayme runtime already has an active owner."
  );
  first.destroy();
  const second = environment([provideAyme({ pageFactory })]);
  expect(
    runInInjectionContext(second, () => injectPageObject(Model))
  ).toBeInstanceOf(Model);
});

it("rejects a Page Object Model the compiler did not reach", () => {
  class Uncompiled {}
  const root = environment([provideAyme({ pageFactory })]);

  expect(() =>
    runInInjectionContext(root, () => injectPageObject(Uncompiled))
  ).toThrow("no compiler-derived Ayme metadata");
});
