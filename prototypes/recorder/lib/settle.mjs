// The settle rule: after the main frame has loaded, every frame must show no
// DOM mutation (light DOM and open shadow roots) for QUIET_MS, or DEADLINE_MS
// passes. One evaluate per frame; nothing is installed in the page beforehand.
export const QUIET_MS = 150;
export const DEADLINE_MS = 2000;

const waitQuiet = ({ quietMs, deadlineMs }) =>
  new Promise((resolve) => {
    const started = performance.now();
    let timer;
    const done = (stable) => {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(deadline);
      resolve({ stable, ms: Math.round(performance.now() - started) });
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => done(true), quietMs);
    };
    const observer = new MutationObserver(arm);
    const options = {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    };
    const observe = (root) => {
      observer.observe(root, options);
      for (const el of root.querySelectorAll("*"))
        if (el.shadowRoot) observe(el.shadowRoot);
    };
    observe(document);
    const deadline = setTimeout(() => done(false), deadlineMs);
    arm();
  });

export async function settle(
  page,
  { quietMs = QUIET_MS, deadlineMs = DEADLINE_MS } = {}
) {
  const started = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.waitForLoadState("load", { timeout: deadlineMs });
    } catch {
      // a slow load is reported as not stable below
    }
    try {
      const results = await Promise.all(
        page.frames().map((frame) =>
          frame.evaluate(waitQuiet, { quietMs, deadlineMs }).catch((error) => {
            // a frame that went away while we waited does not block the rest
            if (frame.isDetached()) return { stable: true, ms: 0 };
            throw error;
          })
        )
      );
      return {
        stable: results.every((r) => r.stable),
        ms: Date.now() - started,
      };
    } catch {
      // the main frame navigated under the evaluate: wait for the new document
    }
  }
  return { stable: false, ms: Date.now() - started };
}
