import type { Locator, Page } from "@playwright/test";
import { isAymeLocator } from "@ayme-dev/webmcp/internal";
import type { TraceEntry } from "./trace";

export type { TraceEntry } from "./trace";

export type DemoFeedbackOptions = {
  beforeActionMs?: number;
  clickCue?: boolean;
  onTrace: (entry: TraceEntry) => void;
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
export function withDemoFeedback(
  page: Page,
  options: DemoFeedbackOptions
): Page {
  const existing = wrappedPages.get(page);
  if (existing) {
    existing.context.listeners.add(options.onTrace);
    existing.context.options.beforeActionMs = Math.max(
      existing.context.options.beforeActionMs ?? 0,
      options.beforeActionMs ?? 0
    );
    existing.context.options.clickCue ||= options.clickCue;
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
          const operation = traceOperation(property);
          if (!isAymeLocator(target) || !operation)
            return wrapResult(member.apply(target, args));

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
          for (const listener of context.listeners) listener(entry);

          return (async () => {
            if (operation !== "waitFor" && operation !== "expect") {
              if (context.options.beforeActionMs)
                await new Promise((resolve) =>
                  setTimeout(resolve, context.options.beforeActionMs)
                );
              if (operation === "click" && context.options.clickCue)
                await showClickCue(locator);
            }
            return wrapResult(member.apply(target, args));
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
