import type { AriaRef } from "@ayme-dev/core/structural-observation";
import type { Locator, Page } from "@playwright/test";

import {
  interactionOf,
  type CallSubject,
  type Interaction,
} from "../domain/interactions";
import { answersAtOnce, elementsOf } from "../domain/playwrightCalls";
import type { ActionCalls } from "../application/run";

type PageInstrumentation = (page: Page) => Page;

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
 * `onInteraction` hears each call that is an Interaction, before it runs:
 * once the ref of the element it acts on is read in the page, when its
 * locator names none. `latestRefOf` reads that ref: the latest recorded page
 * state's of the document in the browser, of the session's Page in Node.
 * `actionCalls`, a Host's, decides when each call starts, or refuses it.
 */
export function instrumentedPage(
  page: Page,
  onInteraction: ((interaction: Interaction) => void) | undefined,
  latestRefOf: (locator: Locator) => Promise<AriaRef | undefined>,
  actionCalls?: ActionCalls
): Page {
  const derivePage = () => {
    let instrumented = page;
    for (const instrumentation of instrumentations)
      instrumented = instrumentation(instrumented);
    return instrumented;
  };
  // Starts `call` once the Host lets an action's call start: a refused call
  // fails as Playwright's own calls do, it rejects.
  const afterAsking = <T>(call: () => T): T | Promise<T> => {
    if (!actionCalls) return call();
    try {
      const waiting = actionCalls.before(false);
      return waiting ? waiting.then(call) : call();
    } catch (error) {
      return Promise.reject(error);
    }
  };
  let resolvePage = derivePage;
  const isPage = (value: unknown) => value === page || value === resolvePage();
  // What Playwright hands out besides the Page, its locators and its input
  // devices, through which an action can still reach the browser: a Frame,
  // an ElementHandle, the BrowserContext, another Page, a Dialog. Each is
  // wrapped once, so it stays the same object, and its calls go to the Host.
  const handedOut = new WeakMap<object, object>();
  const gated = (value: unknown): unknown => {
    if (isPage(value)) return proxyPage;
    if (!actionCalls) return value;
    if (Array.isArray(value))
      return value.some((each) => isPage(each) || isPlaywrightObject(each))
        ? value.map(gated)
        : value;
    if (!isPlaywrightObject(value)) return value;
    let proxy = handedOut.get(value);
    if (!proxy) {
      proxy = gatedObject(value);
      handedOut.set(value, proxy);
    }
    return proxy;
  };
  const gatedResult = (result: unknown) =>
    result instanceof Promise ? result.then(gated) : gated(result);
  // A listener Playwright calls later runs as the code that registered it,
  // and gets what it is handed wrapped too; removing it by the function the
  // action registered still works.
  const listeners = new WeakMap<Callback, Callback>();
  const listening = (property: string | symbol, args: unknown[]) => {
    const [first, listener, ...rest] = args;
    if (!actionCalls || typeof listener !== "function") return args;
    if (removesListener.has(property)) {
      const bound = listeners.get(listener as Callback);
      return bound ? [first, bound, ...rest] : args;
    }
    if (!addsListener.has(property)) return args;
    let bound = listeners.get(listener as Callback);
    if (!bound) {
      const original = listener as Callback;
      const inAction = actionCalls.bind(original);
      bound = function (this: unknown, ...heard: unknown[]) {
        return inAction.apply(this, heard.map(gated));
      };
      listeners.set(original, bound);
    }
    return [first, bound, ...rest];
  };
  const gatedObject = (target: object): object => {
    // Answering a dialog is what a held call waits for, so it is never held.
    const neverHeld = (target as { _type?: unknown })._type === "Dialog";
    return new Proxy(target, {
      get(_, property) {
        const member: unknown = Reflect.get(target, property);
        // Playwright reads its own fields when it is handed the object back.
        if (typeof property !== "string" || property.startsWith("_"))
          return member;
        if (typeof member !== "function") return gated(member);
        const send = (args: unknown[]) =>
          gatedResult(Reflect.apply(member, target, listening(property, args)));
        // Only a method that always answers with a promise may be held, so
        // a method the runtime does not know answers as it always does.
        if (neverHeld || !isAsync(member))
          return (...args: unknown[]) => {
            try {
              actionCalls!.before(true);
            } catch (error) {
              if (isAsync(member)) return Promise.reject(error);
              throw error;
            }
            return send(args);
          };
        return (...args: unknown[]) => afterAsking(() => send(args));
      },
    });
  };
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
      if (isLocator(result))
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
      return gatedResult(result);
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
        if (typeof member !== "function") return gated(member);
        const perform = (args: unknown[]) => {
          const target = resolve();
          const run = () =>
            bindResult(
              call(target, property, listening(property, args)),
              property,
              args
            );
          const interaction =
            onInteraction && interactionOf(subject, target, property, args);
          if (!interaction) return run();
          const [locator] = elementsOf(subject, target, String(property), args);
          if (interaction.ref !== undefined || !locator) {
            onInteraction!(interaction);
            return run();
          }
          // Every Interaction on an element is asynchronous, so its ref is
          // read in the page before the input reaches the element. The Host
          // is asked again once it is read, as it may have stopped the
          // action meanwhile.
          return refOfLocator(locator, latestRefOf)
            .then((ref) => afterAsking(() => ref))
            .then((ref) => {
              onInteraction!(ref ? { ...interaction, ref } : interaction);
              return run();
            });
        };
        if (!actionCalls) return (...args: unknown[]) => perform(args);
        const atOnce = answersAtOnce(subject, property);
        return (...args: unknown[]) => {
          if (atOnce) {
            void actionCalls.before(true);
            return perform(args);
          }
          return afterAsking(() => perform(args));
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

type Callback = (...args: unknown[]) => unknown;

// The methods that register a function Playwright calls later with what it
// hands out, as their second argument, and those that remove one.
const addsListener = new Set<string | symbol>([
  "on",
  "once",
  "addListener",
  "prependListener",
  "prependOnceListener",
  "route",
  "routeWebSocket",
  "exposeBinding",
  "exposeFunction",
  "addLocatorHandler",
  "waitForEvent",
]);
const removesListener = new Set<string | symbol>([
  "off",
  "removeListener",
  "unroute",
]);

const isAsync = (method: unknown) =>
  Object.prototype.toString.call(method) === "[object AsyncFunction]";

/** Whether Playwright's client made `value` to reach the browser through:
 * one of its objects with a channel to the browser, or an instance that
 * holds one, as a FrameLocator holds its Frame. */
function isPlaywrightObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null || value instanceof Promise)
    return false;
  if (isClientObject(value)) return true;
  const prototype: unknown = Object.getPrototypeOf(value);
  return (
    prototype !== Object.prototype &&
    prototype !== null &&
    !Array.isArray(value) &&
    Object.values(value).some(isClientObject)
  );
}

/** Playwright's public API has no brand to test; every object of its client
 * that talks to the browser has a guid on its connection. */
function isClientObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { _guid?: unknown })._guid === "string" &&
    "_connection" in value
  );
}

/** Diagnostic resolution must never wait for an element or prevent the actual call. */
function refOfLocator(
  locator: Locator,
  latestRefOf: (locator: Locator) => Promise<AriaRef | undefined>
): Promise<AriaRef | undefined> {
  return latestRefOf(locator).catch(() => undefined);
}

/**
 * Whether a call answered a Locator, which its Page must wrap: Playwright's
 * public API has no brand to test, so its shape tells, as only a Locator
 * both evaluates on all it matches and picks one of them.
 */
function isLocator(value: unknown): value is Locator {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Locator).evaluateAll === "function" &&
    typeof (value as Locator).nth === "function"
  );
}
