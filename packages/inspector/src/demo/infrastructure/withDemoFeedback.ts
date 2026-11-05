import type { Locator, Page } from "@playwright/test";
import { inPage, isAymeLocator, pageOfDocument } from "@ayme-dev/ayme/internal";
import { passThroughWhileCovered } from "../../panel";
import { describeCall, type CallSubject } from "../../shared";

type DemoFeedbackOptions = {
  beforeActionMs?: number;
  clickCue?: boolean;
};

type FeedbackContext = {
  /** The latest wrap's options. */
  options: DemoFeedbackOptions;
  wrappers: WeakMap<object, object>;
};

const wrappedPages = new WeakMap<
  object,
  { context: FeedbackContext; proxy: Page }
>();

// Diagnostic decoration. The underlying Page and its locator brands stay intact.
// Each call goes as describeCall says: paced and cued in demo mode, and
// passed through the Inspector panel when it covers a pointer action.
export function withDemoFeedback(
  page: Page,
  options: DemoFeedbackOptions = {}
): Page {
  // Wrapped again, as each install of the Inspector does: the latest
  // options pace and cue it.
  const existing = wrappedPages.get(page);
  if (existing) {
    existing.context.options = options;
    return existing.proxy;
  }

  const context: FeedbackContext = { options, wrappers: new WeakMap() };

  function wrapResult(result: unknown): unknown {
    if (result === page) return wrap(page, "page");
    if (isAymeLocator(result)) return wrap(result as Locator, "locator");
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

          return (async () => {
            if (context.options.beforeActionMs)
              await new Promise((resolve) =>
                setTimeout(resolve, context.options.beforeActionMs)
              );
            if (call.cue && context.options.clickCue)
              await showClickCue(call.cue);
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

async function showClickCue(locator: Locator) {
  // The runtime's in-page module reads the element's geometry and shows the
  // cue, only for an element that is there now, so a click that will fail, or
  // wait for its element, isn't held up by the cue's own wait.
  await inPage(pageOfDocument(document)).cue(locator);
}
