import { isPlaywrightLiteLocator } from "@ayme-dev/playwright-lite/internal";

import {
  interactionOf,
  type CallSubject,
  type Interaction,
} from "./interactions";
import type { AymePage } from "./runtime";

type PageInstrumentation = (page: AymePage) => AymePage;

// The Page's input devices, which a Page Object may save as properties.
const inputDevices = new Set<string | symbol>(["keyboard", "mouse"]);

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
 * locator resolves its target when it is called, so a saved method does too,
 * and so does a saved keyboard or mouse.
 *
 * `onInteraction` hears each call that is an Interaction, before it runs.
 */
export function instrumentedPage(
  page: AymePage,
  onInteraction?: (interaction: Interaction) => void
): AymePage {
  const derivePage = () => {
    let instrumented = page;
    for (const instrumentation of instrumentations)
      instrumented = instrumentation(instrumented);
    return instrumented;
  };
  let resolvePage = derivePage;
  const isPage = (value: unknown) => value === page || value === resolvePage();
  const devices = new Map<string | symbol, object>();
  const device = (property: string | symbol) => {
    let bound = devices.get(property);
    if (!bound) {
      bound = lateBound(
        property as CallSubject,
        () => Reflect.get(resolvePage(), property) as object
      ).proxy;
      devices.set(property, bound);
    }
    return bound;
  };

  function lateBound<T extends object>(
    subject: CallSubject,
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
      lateBound("locator", rederive, { generation, target: locator }).proxy;
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
        const target = resolve();
        const member: unknown = Reflect.get(target, property);
        if (
          inputDevices.has(property) &&
          typeof member === "object" &&
          member !== null &&
          isPage(target)
        )
          return device(property);
        if (typeof member !== "function") return member;
        return (...args: unknown[]) => {
          const target = resolve();
          const interaction =
            onInteraction && interactionOf(subject, target, property, args);
          if (interaction) onInteraction(interaction);
          return bindResult(call(target, property, args), property, args);
        };
      },
    });
    return { proxy, resolve };
  }

  const root = lateBound("page", derivePage);
  resolvePage = root.resolve;
  const proxyPage = root.proxy;
  return proxyPage;
}
