import { isPlaywrightLiteLocator } from "@ayme-dev/playwright-lite/internal";

import type { AymePage } from "./runtime";

type PageInstrumentation = (page: AymePage) => AymePage;

const instrumentations = new Set<PageInstrumentation>();
// Changes on every install and uninstall, so late-bound targets re-derive.
let generation = 0;

export function installRuntimePageInstrumentation(
  instrumentation: PageInstrumentation
) {
  instrumentations.add(instrumentation);
  generation += 1;
  return () => {
    if (instrumentations.delete(instrumentation)) generation += 1;
  };
}

/**
 * Wraps a session's Page so every call goes through the instrumentations
 * installed at the time of the call. Locators derived from it, synchronously
 * or as `all()`'s items, re-derive from the instrumented Page when those
 * change, and a Page a locator returns is the wrapped Page again. So a Page
 * Object constructed before an instrumentation was installed, such as a
 * late-loaded Inspector's, still reaches it. A method read from the Page or a
 * locator resolves its target when it is called, so a saved method does too.
 */
export function instrumentedPage(page: AymePage): AymePage {
  const derivePage = () => {
    let instrumented = page;
    for (const instrumentation of instrumentations)
      instrumented = instrumentation(instrumented);
    return instrumented;
  };
  let resolvePage = derivePage;
  const isPage = (value: unknown) => value === page || value === resolvePage();

  function lateBound<T extends object>(
    derive: () => T,
    initial = { generation, target: derive() }
  ): { proxy: T; resolve: () => T } {
    let current = initial;
    const resolve = () => {
      if (current.generation !== generation)
        current = { generation, target: derive() };
      return current.target;
    };
    const call = (target: T, property: string | symbol, args: unknown[]) =>
      (
        Reflect.get(target, property, target) as (...args: unknown[]) => unknown
      ).apply(target, args);
    const bindLocator = (locator: object, rederive: () => object) =>
      lateBound(rederive, { generation, target: locator }).proxy;
    const bindResult = (
      result: unknown,
      property: string | symbol,
      args: unknown[]
    ): unknown => {
      if (isPage(result)) return proxyPage;
      if (isPlaywrightLiteLocator(result))
        return bindLocator(
          result as object,
          () => call(resolve(), property, args) as object
        );
      if (result instanceof Promise && property === "all")
        return result.then((locators: unknown[]) =>
          locators.map((locator, index) =>
            bindLocator(
              locator as object,
              () => call(resolve(), "nth", [index]) as object
            )
          )
        );
      if (result instanceof Promise)
        return result.then((value) => (isPage(value) ? proxyPage : value));
      return result;
    };
    const proxy = new Proxy(initial.target, {
      get(_, property) {
        const member: unknown = Reflect.get(resolve(), property);
        if (typeof member !== "function") return member;
        return (...args: unknown[]) =>
          bindResult(call(resolve(), property, args), property, args);
      },
    });
    return { proxy, resolve };
  }

  const root = lateBound(derivePage);
  resolvePage = root.resolve;
  const proxyPage = root.proxy;
  return proxyPage;
}
