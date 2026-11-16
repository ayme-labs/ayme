import type { Locator, Page } from "@playwright/test";

import { inPage, type InPage } from "../../in-page";
import {
  elementsOf,
  kindOf,
  type CallSubject,
} from "../domain/playwrightCalls";

/** How long demo mode pauses before each action. */
export const DEMO_PAUSE_MS = 500;

/**
 * Demo mode's feedback on the runtime's Pages (the `inspector` option's
 * `demo`): each call that acts pauses before it, each click shows a cue where
 * it lands, and each pointer action reaches the elements under an excluded
 * subtree, which it lets through while it covers one. Reads, waits and
 * configuration run as they are (`kindOf` says which calls act).
 */
export function demoFeedback(
  page: Page,
  options: DemoFeedbackOptions | (() => DemoFeedbackOptions) = DEMO
): Page {
  return wrapPage(
    page,
    typeof options === "function" ? options : () => options
  );
}

const DEMO: DemoFeedbackOptions = {
  beforeActionMs: DEMO_PAUSE_MS,
  clickCue: true,
};
const OFF: DemoFeedbackOptions = {};
const demoRequests = new Set<symbol>();

/**
 * Asks for Demo Mode until the returned release is called: the session's
 * `inspector: { demo: true }` and a panel mounted with `demo` each ask once.
 */
export function requestDemoMode(): () => void {
  const request = Symbol("demo");
  demoRequests.add(request);
  return () => void demoRequests.delete(request);
}

/** What the runtime's Pages do now: pause and cue while anyone asks for Demo Mode. */
export const demoModeOptions = (): DemoFeedbackOptions =>
  demoRequests.size > 0 ? DEMO : OFF;

export type DemoFeedbackOptions = {
  /** How long to pause before each acting call; none when 0. */
  beforeActionMs?: number;
  /** Whether a click shows its cue where it lands. */
  clickCue?: boolean;
};

/** What a call on the runtime's Page does for demo mode. */
export type CallDescription = {
  /** The element demo mode cues, for a call that clicks one. */
  cue?: Locator;
  /** The elements it hit-tests, which an excluded subtree lets pointer events reach. */
  hitTargets: Locator[];
};

/**
 * What a call on the runtime's Page does, as ayme's Playwright call table
 * says: undefined for one that only reads, waits, builds a locator,
 * configures or scrolls, which runs as it is. One that acts is paced in demo
 * mode; one through the pointer is hit-tested, and a click is cued.
 */
export function describeCall(
  subject: CallSubject,
  target: object,
  method: string | symbol,
  args: unknown[]
): CallDescription | undefined {
  const kind = kindOf(subject, method);
  if (kind === undefined || kind === "none") return undefined;
  const pointer = kind === "point" || kind === "click";
  const elements = pointer
    ? (elementsOf(subject, target, method as string, args) as Locator[])
    : [];
  return {
    ...(kind === "click" && elements[0] && { cue: elements[0] }),
    hitTargets: elements,
  };
}

type FeedbackContext = {
  options: () => DemoFeedbackOptions;
  wrappers: WeakMap<object, object>;
};

const wrappedPages = new WeakMap<
  object,
  { context: FeedbackContext; proxy: Page }
>();

function wrapPage(page: Page, options: () => DemoFeedbackOptions): Page {
  // Wrapped again, as each install does: the latest options pace and cue it.
  const existing = wrappedPages.get(page);
  if (existing) {
    existing.context.options = options;
    return existing.proxy;
  }
  const context: FeedbackContext = { options, wrappers: new WeakMap() };

  function wrapResult(result: unknown): unknown {
    if (result === page) return wrap(page, "page");
    if (isLocator(result)) return wrap(result, "locator");
    if (Array.isArray(result)) return result.map(wrapResult);
    if (result instanceof Promise) return result.then(wrapResult);
    return result;
  }

  function wrap<T extends object>(target: T, subject: CallSubject): T {
    const cached = context.wrappers.get(target);
    if (cached) return cached as T;

    const proxy = new Proxy(target, {
      get(target, property) {
        const member: unknown = Reflect.get(target, property, target);
        if (
          subject === "page" &&
          (property === "keyboard" || property === "mouse") &&
          typeof member === "object" &&
          member !== null
        )
          return wrap(member, property);
        if (typeof member !== "function") return member;

        return (...args: unknown[]) => {
          const call = describeCall(subject, target, property, args);
          if (!call) return wrapResult(member.apply(target, args));
          // Nothing to pace or cue, and no pointer to let through: the call
          // runs as it is.
          const { beforeActionMs, clickCue } = context.options();
          if (
            !beforeActionMs &&
            !(call.cue && clickCue) &&
            call.hitTargets.length === 0
          )
            return wrapResult(member.apply(target, args));

          return (async () => {
            if (beforeActionMs)
              await new Promise((resolve) =>
                setTimeout(resolve, beforeActionMs)
              );
            if (call.cue && clickCue) await inPage(page).cue(call.cue);
            return wrapResult(
              await passThroughWhileCovered(call.hitTargets, () =>
                member.apply(target, args)
              )
            );
          })();
        };
      },
    });
    context.wrappers.set(target, proxy);
    return proxy;
  }

  const proxy = wrap(page, "page");
  wrappedPages.set(page, { context, proxy });
  wrappedPages.set(proxy, { context, proxy });
  return proxy;
}

function isLocator(value: unknown): value is Locator {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Locator).evaluateAll === "function" &&
    typeof (value as Locator).nth === "function"
  );
}

// Lets a pointer action reach the elements under an excluded subtree, such as
// the Inspector's panel: while one of its targets comes under one, the
// subtree's root lets pointer events through until the action ends, with the
// runtime's hit-test mark. The in-page module does the looking and the
// marking. Playwright Lite retries a failed hit-target check after 0, 20, 100,
// 100, then 500ms; polling at 25ms keeps detection ahead of the early retries.
const COVER_POLL_MS = 25;

/** The pointer actions now letting events through, per page's module. */
const holds = new WeakMap<InPage, number>();

export async function passThroughWhileCovered<T>(
  targets: readonly Locator[],
  action: () => T
): Promise<Awaited<T>> {
  if (targets.length === 0) return await action();
  const module = inPage(targets[0]!.page());
  // The only thing a pointer action asks of the page when nothing is excluded.
  if (!(await module.hasExcludedSubtree().catch(() => false)))
    return await action();

  let done = false;
  let held = false;
  void (async () => {
    while (!done) {
      for (const target of targets) {
        const covered = await module
          .coveredByExcluded(target)
          .catch(() => false);
        if (done) return;
        if (covered) {
          held = true;
          hold(module);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, COVER_POLL_MS));
    }
  })();
  try {
    return await action();
  } finally {
    done = true;
    if (held) await release(module);
  }
}

function hold(module: InPage) {
  const count = (holds.get(module) ?? 0) + 1;
  holds.set(module, count);
  if (count === 1) void module.passThroughExcluded(true).catch(() => {});
}

async function release(module: InPage) {
  const count = (holds.get(module) ?? 1) - 1;
  holds.set(module, count);
  if (count === 0) await module.passThroughExcluded(false).catch(() => {});
}
