// The in-page module's contract over Playwright Lite: every page is a frame
// whose own runtime hosts the module, as an app's runtime does.
import type { Page } from "@playwright/test";
import { afterEach, describe } from "vitest";

import { inPageContract } from "./inPageContract.testSupport";
import type { LiteFrame } from "./liteFrame.testSupport";

const frames = new Map<Page, HTMLIFrameElement>();
const runtime = new URL("./liteFrame.testSupport.ts", import.meta.url).href;

/** Loads `frame`'s document, or its next one, and answers its Lite frame. */
async function loaded(frame: HTMLIFrameElement, load: () => void) {
  const done = new Promise((resolve) =>
    frame.addEventListener("load", resolve, { once: true })
  );
  load();
  await done;
  const window = frame.contentWindow as Window & { aymeLiteFrame?: LiteFrame };
  for (let tries = 0; !window.aymeLiteFrame; tries += 1) {
    if (tries > 200) throw new Error("The frame's runtime never started.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  frames.set(window.aymeLiteFrame.page, frame);
  return window.aymeLiteFrame;
}

function frameOf(page: Page) {
  const frame = frames.get(page);
  if (!frame) throw new Error("No frame shows this page.");
  return frame.contentWindow as Window & { aymeLiteFrame: LiteFrame };
}

afterEach(() => {
  for (const frame of frames.values()) frame.remove();
  frames.clear();
});

describe("the in-page module over Playwright Lite", () => {
  inPageContract({
    async newPage() {
      const frame = document.createElement("iframe");
      const { page } = await loaded(frame, () => {
        frame.srcdoc = `<!doctype html><script type="module" src="${runtime}"></script>`;
        document.body.append(frame);
      });
      return page;
    },
    createHost: (page, version) =>
      frameOf(page).aymeLiteFrame.createHost(version),
    async reload(page) {
      const window = frameOf(page);
      const frame = frames.get(page)!;
      frames.delete(page);
      const next = await loaded(frame, () => window.location.reload());
      return next.page;
    },
    async nextDocument(page) {
      const next = await loaded(frames.get(page)!, () => {});
      return next.page;
    },
    hostsOutliveLoads: false,
  });
});
