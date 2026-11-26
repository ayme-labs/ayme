// Spike (hidden tab): what the background process hears of its Tab's
// visibility, from the page itself: a binding the page calls on each
// `visibilitychange`, which reaches Node without a timer or a frame.
//
// Variant, from the environment:
// - AYME_SPIKE_HIDDEN: "off" (default: a hidden Tab changes nothing),
//   "refuse" (a Page Object Tool's Run does not start on a hidden Tab), or
//   "end" (as "refuse", and a Tab hidden during a Run ends that Run as a
//   dialog does: the command answers at once and the action's further
//   Playwright calls are refused).
import type { Page } from "@playwright/test";

import { spikeLog } from "./dialogs";

export const hiddenMode = (process.env.AYME_SPIKE_HIDDEN ?? "off") as
  "off" | "refuse" | "end";

const BINDING = "__aymeSpikeVisibility";

/** Starts hearing `page`'s visibility; `onChange` hears each change. */
export async function watchVisibility(
  page: Page,
  onChange: (state: string) => void
) {
  let state = "unknown";
  await page.exposeBinding(BINDING, (_source, next: string) => {
    if (next === state) return;
    state = next;
    spikeLog("vis", { state });
    onChange(state);
  });
  const install = (binding: string) => {
    const tell = () =>
      (window as unknown as Record<string, (state: string) => void>)[binding]!(
        document.visibilityState
      );
    document.addEventListener("visibilitychange", tell);
    tell();
  };
  await page.addInitScript(install, BINDING);
  await page.evaluate(install, BINDING);
  return { state: () => state };
}

/** What a command prints when its Run would start, or was running, on a hidden Tab. */
export const hiddenText = (during: boolean) =>
  during
    ? "The Tab was hidden during the Run, so Ayme stopped the action. Show the Tab with your browser automation, then run ayme again."
    : "The Tab is hidden, so Ayme does not start the Run. Show the Tab with your browser automation, then run ayme again.";
