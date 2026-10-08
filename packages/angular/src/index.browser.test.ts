// Contract rows are in docs/framework-integrations.md. C9 and C10 run in
// Node, in ssr.test.ts.
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
import { createAyme } from "@ayme-dev/ayme";
import {
  injectAyme,
  injectPageObject,
  injectPeek,
  provideAyme,
  type AymeOptions,
} from "./index";

vi.mock("@ayme-dev/ayme", async (importOriginal) => {
  const original = await importOriginal<typeof import("@ayme-dev/ayme")>();
  return { ...original, createAyme: vi.fn(original.createAyme) };
});

type Page = ReturnType<NonNullable<AymeOptions["pageFactory"]>>;
const page = { url: () => "factory page" } as unknown as Page;
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
// The runtime waits 2 s for a WebMCP driver before reporting `unavailable`.
const pastDriverWait = 2_100;

afterEach(() => {
  for (const injector of injectors.splice(0).reverse())
    // Angular 19 does not declare `destroyed` on EnvironmentInjector.
    if (!(injector as { destroyed?: boolean }).destroyed) injector.destroy();
  vi.useRealTimers();
  vi.mocked(createAyme).mockClear();
});

it("C1: passes every runtime option to the session unchanged", async () => {
  // Keep the optional Inspector and Agent Connection peers from loading; they
  // may not be built or installed where these tests run.
  const { createAyme: actual } =
    await vi.importActual<typeof import("@ayme-dev/ayme")>("@ayme-dev/ayme");
  vi.mocked(createAyme).mockImplementationOnce((options) =>
    actual({ ...options, inspector: false, agentConnection: false })
  );
  const options: AymeOptions = {
    pageFactory,
    ignore: (element) => element.matches(".assistant"),
    customTools: [
      {
        name: "highlight_element",
        description: "Highlight one element on the page.",
        execute: async () => null,
      },
    ],
    goalLoop: vi.fn(),
    navigate: vi.fn(),
    webMCP: { enabled: false, toolNamePrefix: "ayme_" },
    inspector: true,
    agentConnection: true,
  };
  const root = environment([provideAyme(options)]);
  runInInjectionContext(root, injectAyme);

  expect(createAyme).toHaveBeenCalledExactlyOnceWith(options);
  expect(vi.mocked(createAyme).mock.calls[0]![0]).toBe(options);
});

it.skip("C4: n/a, provideAyme takes its options once and cannot change them afterwards", () => {});

it("C2: starts the session with the environment and stops it when the injector is destroyed", async () => {
  const goalLoop = vi.fn(async () => {
    throw new Error("No decision.");
  });
  const root = environment([provideAyme({ pageFactory, goalLoop })]);
  const { ayme } = runInInjectionContext(root, injectAyme);

  // Started before any consumer asks for it.
  await ayme.tools.run("goal", { goal: "goal", maxSteps: 1 });
  expect(goalLoop).toHaveBeenCalledOnce();
  root.destroy();
  expect(ayme.webMCP.publicationStatus.state).toBe("disposed");
  await expect(
    ayme.tools.run("goal", { goal: "goal", maxSteps: 1 })
  ).rejects.toThrow("the Ayme runtime session is not started.");
});

it("C3: rejects provideAyme beneath another provideAyme", () => {
  const root = environment([provideAyme({ pageFactory })]);

  expect(() => environment([provideAyme({ pageFactory })], root)).toThrow(
    "provideAyme cannot be nested beneath another Ayme runtime owner."
  );
});

it("C3: keeps one owner per document across root injectors, as two applications have, and allows a new one after the first is destroyed", () => {
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

it("C5: returns { ayme, webMCP } whose publication status is a signal that follows the session, with the session's own retry", async () => {
  vi.useFakeTimers();
  const root = environment([
    provideAyme({ pageFactory, webMCP: { enabled: true } }),
  ]);
  const { ayme, webMCP } = runInInjectionContext(root, injectAyme);

  expect(Object.keys(webMCP)).toEqual([
    "publicationStatus",
    "retryPublication",
  ]);
  expect(webMCP.retryPublication).toBe(ayme.webMCP.retryPublication);
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

it("C5: reports publication as disabled unless webMCP is enabled", () => {
  const root = environment([provideAyme({ pageFactory })]);
  const { webMCP } = runInInjectionContext(root, injectAyme);

  expect(webMCP.publicationStatus()).toEqual({
    state: "disabled",
    message: "WebMCP publication is disabled.",
  });
});

it("C6: registers a Page Object until its injector is destroyed, and returns the session's instance", () => {
  const root = environment([provideAyme({ pageFactory })]);
  const scope = environment([], root);

  const model = runInInjectionContext(scope, () => injectPageObject(Model));

  expect(model).toBeInstanceOf(Model);
  expect(model.page.url()).toBe(page.url());
  expect(listRegisteredPoms().map((pom) => pom.instance)).toEqual([model]);
  scope.destroy();
  expect(listRegisteredPoms()).toEqual([]);
});

it("C6: keeps a Page Object registered while any consumer of its model lives", () => {
  const root = environment([provideAyme({ pageFactory })]);
  const first = environment([], root);
  const second = environment([], root);
  const one = runInInjectionContext(first, () => injectPageObject(Model));
  const two = runInInjectionContext(second, () => injectPageObject(Model));

  expect(two).toBe(one);
  first.destroy();
  expect(listRegisteredPoms().map((pom) => pom.instance)).toEqual([one]);
  second.destroy();
  expect(listRegisteredPoms()).toEqual([]);
});

it("C7: rejects injectAyme, injectPageObject and injectPeek without provideAyme above", () => {
  const root = environment();

  for (const inject of [
    injectAyme,
    () => injectPageObject(Model),
    () => injectPeek({}, "peek"),
  ] as (() => unknown)[])
    expect(() => runInInjectionContext(root, inject)).toThrow(
      "Ayme requires provideAyme() in an ancestor injector."
    );
});

it("C7: rejects injectAyme, injectPageObject and injectPeek outside an injection context", () => {
  for (const inject of [
    injectAyme,
    () => injectPageObject(Model),
    () => injectPeek({}, "peek"),
  ] as (() => unknown)[])
    expect(inject).toThrow(/NG0203/);
});

it("C8: rejects a Page Object Model the compiler did not reach", () => {
  class Uncompiled {}
  const root = environment([provideAyme({ pageFactory })]);

  expect(() =>
    runInInjectionContext(root, () => injectPageObject(Uncompiled))
  ).toThrow("The imported page object has no compiler-derived Ayme metadata.");
});

it("C11: returns the session as ayme, so a goal runs with the owner's goalLoop", async () => {
  const goalLoop = vi.fn(async () => {
    throw new Error("No decision.");
  });
  const root = environment([provideAyme({ pageFactory, goalLoop })]);
  const scope = environment([], root);

  for (const injector of [root, scope]) {
    const { ayme } = runInInjectionContext(injector, injectAyme);
    const handover = await ayme.tools.run("goal", {
      goal: "Save the form",
      maxSteps: 1,
    });
    expect(handover.reason).toBe("decide_failed");
  }
  expect(goalLoop).toHaveBeenCalledTimes(2);
});
