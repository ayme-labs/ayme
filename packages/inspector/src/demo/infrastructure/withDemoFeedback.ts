import type { Locator, Page } from "@playwright/test";
import { isAymeLocator } from "@ayme-dev/ayme/internal";
import { isPointerAction, passThroughWhileCovered } from "../../panel";
import type { TraceEntry } from "../../runs";

type DemoFeedbackOptions = {
  beforeActionMs?: number;
  clickCue?: boolean;
  /** Called before each traced operation, with the locator it acts on. */
  onTrace: (entry: TraceEntry, locator: Locator) => void;
};

type FeedbackContext = {
  listeners: Set<DemoFeedbackOptions["onTrace"]>;
  options: Omit<DemoFeedbackOptions, "onTrace">;
  wrappers: WeakMap<object, object>;
};

const wrappedPages = new WeakMap<
  object,
  { context: FeedbackContext; proxy: Page }
>();

// Diagnostic decoration. The underlying Page and its locator brands stay intact.
// Pointer actions also pass through the Inspector panel when it covers them.
export function withDemoFeedback(
  page: Page,
  options: DemoFeedbackOptions
): Page {
  // Wrapped again, as each install of the Inspector does: the latest
  // options pace and cue it.
  const existing = wrappedPages.get(page);
  if (existing) {
    existing.context.listeners.add(options.onTrace);
    existing.context.options = {
      beforeActionMs: options.beforeActionMs,
      clickCue: options.clickCue,
    };
    return existing.proxy;
  }

  const context: FeedbackContext = {
    listeners: new Set([options.onTrace]),
    options: {
      beforeActionMs: options.beforeActionMs,
      clickCue: options.clickCue,
    },
    wrappers: new WeakMap(),
  };

  function wrapResult(result: unknown): unknown {
    if (result === page) return wrap(page);
    if (isAymeLocator(result)) return wrap(result as Locator);
    if (Array.isArray(result)) return result.map(wrapResult);
    if (result instanceof Promise) return result.then(wrapResult);
    return result;
  }

  function wrap<T extends Page | Locator>(target: T): T {
    const cached = context.wrappers.get(target);
    if (cached) return cached as T;

    const proxy = new Proxy(target, {
      get(target, property) {
        const member: unknown = Reflect.get(target, property, target);
        if (typeof member !== "function") return member;

        return (...args: unknown[]) => {
          const operation = isAymeLocator(target)
            ? traceOperation(property)
            : undefined;
          const targets = isPointerAction(property)
            ? pointerTargets(target, property, args)
            : [];
          if (!operation && targets.length === 0)
            return wrapResult(member.apply(target, args));

          const act = () =>
            passThroughWhileCovered(targets, () =>
              member.apply(target, args)
            ).then(wrapResult);
          if (!operation) return act();

          const locator = target as Locator;
          const entry: TraceEntry = {
            operation,
            locator: locator.toString(),
            ...(typeof args[0] === "string" && operation !== "expect"
              ? { value: args[0] }
              : {}),
            ...(operation === "waitFor"
              ? {
                  state:
                    (args[0] as { state?: string } | undefined)?.state ??
                    "visible",
                }
              : {}),
          };
          for (const listener of context.listeners) listener(entry, locator);

          return (async () => {
            if (operation !== "waitFor" && operation !== "expect") {
              if (context.options.beforeActionMs)
                await new Promise((resolve) =>
                  setTimeout(resolve, context.options.beforeActionMs)
                );
              if (operation === "click" && context.options.clickCue)
                await showClickCue(locator);
            }
            return act();
          })();
        };
      },
    });
    context.wrappers.set(target, proxy);
    return proxy;
  }

  const proxy = wrap(page);
  wrappedPages.set(page, { context, proxy });
  wrappedPages.set(proxy, { context, proxy });
  return proxy;
}

// The elements a pointer action hit-tests: a locator's own and a drag's drop
// target, or the selectors of the page's own actions, such as the single-element tools'
// `page.click(selector)`.
function pointerTargets(
  target: Page | Locator,
  property: string | symbol,
  args: unknown[]
): Locator[] {
  if (isAymeLocator(target))
    return property === "dragTo" && isAymeLocator(args[0])
      ? [target as Locator, args[0] as Locator]
      : [target as Locator];
  return args
    .slice(0, property === "dragAndDrop" ? 2 : 1)
    .filter((arg): arg is string => typeof arg === "string")
    .map((selector) => (target as Page).locator(selector));
}

// ponytail: only instrument locator operations used by the Inspector; extend as needed.
function traceOperation(
  property: string | symbol
): TraceEntry["operation"] | undefined {
  switch (property) {
    case "click":
    case "fill":
    case "press":
    case "pressSequentially":
    case "waitFor":
      return property;
    case "_expect":
      return "expect";
  }
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
