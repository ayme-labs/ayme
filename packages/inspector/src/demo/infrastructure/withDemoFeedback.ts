import type { Locator, Page } from "@playwright/test";
import { isAymeLocator } from "@ayme-dev/ayme/internal";
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
  // Only an element that is there now gets a cue, so a click that will fail,
  // or wait for its element, isn't held up by the cue's own wait.
  if ((await locator.count()) !== 1) return;
  await locator.evaluate(async (element) => {
    const document = element.ownerDocument;
    const window = document.defaultView;
    const bounds = element.getBoundingClientRect();
    if (!window || !bounds.width || !bounds.height) return;

    const cue = document.createElement("div");
    cue.dataset.demoClickCue = "";
    cue.setAttribute("aria-hidden", "true");
    Object.assign(cue.style, {
      background: "rgb(77 126 219 / 18%)",
      border: "2px solid rgb(77 126 219 / 80%)",
      borderRadius: "999px",
      height: "2rem",
      left: `${bounds.left + bounds.width / 2}px`,
      pointerEvents: "none",
      position: "fixed",
      top: `${bounds.top + bounds.height / 2}px`,
      transform: "translate(-50%, -50%)",
      width: "2rem",
      zIndex: "2147483647",
    });
    document.body.append(cue);
    try {
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      cue.animate(
        reducedMotion
          ? [{ opacity: 0.9 }, { opacity: 0 }]
          : [
              {
                opacity: 0.9,
                transform: "translate(-50%, -50%) scale(0.95)",
              },
              {
                opacity: 0,
                transform: "translate(-50%, -50%) scale(1.35)",
              },
            ],
        {
          duration: 160,
          easing: "cubic-bezier(0.23, 1, 0.32, 1)",
          fill: "forwards",
        }
      );
      await new Promise((resolve) => window.setTimeout(resolve, 160));
    } finally {
      cue.remove();
    }
  });
}
