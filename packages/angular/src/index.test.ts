// @vitest-environment jsdom
import {
  createEnvironmentInjector,
  Injector,
  runInInjectionContext,
  type EnvironmentInjector,
} from "@angular/core";
import {
  listRegisteredPoms,
  registerCompiledPom,
} from "@ayme-dev/ayme/internal";
import { afterEach, expect, it } from "vitest";
import {
  injectAyme,
  injectPageObject,
  provideAyme,
  type AymeOptions,
} from "./index";

type Page = ReturnType<NonNullable<AymeOptions["pageFactory"]>>;
const page = {} as Page;
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
  providers: Parameters<typeof createEnvironmentInjector>[0],
  parent?: EnvironmentInjector
) {
  const injector = createEnvironmentInjector(
    providers,
    parent ?? (Injector.NULL as EnvironmentInjector)
  );
  injectors.push(injector);
  return injector;
}
afterEach(() => {
  for (const injector of injectors.splice(0).reverse())
    if (!injector.destroyed) injector.destroy();
});

it("starts Ayme with the environment and registers a Page Object until its injector is destroyed", () => {
  const root = environment([provideAyme({ pageFactory: () => page })]);
  const scope = environment([], root);

  const model = runInInjectionContext(scope, () => injectPageObject(Model));

  expect(model).toBeInstanceOf(Model);
  expect(model.page).toBe(page);
  expect(listRegisteredPoms().map((pom) => pom.instance)).toEqual([model]);
  scope.destroy();
  expect(listRegisteredPoms()).toEqual([]);
});

it("returns the runtime session and its WebMCP status, and stops it with the environment", () => {
  const root = environment([provideAyme({ pageFactory: () => page })]);
  const { ayme, webMCP } = runInInjectionContext(root, injectAyme);

  expect(webMCP.publicationStatus().state).toBe("disabled");
  expect(ayme.webMCP.publicationStatus.state).toBe("disabled");
  root.destroy();
  expect(ayme.webMCP.publicationStatus.state).toBe("disposed");
});
