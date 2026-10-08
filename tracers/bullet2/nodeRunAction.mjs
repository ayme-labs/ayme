// Node-side action sequence over a Playwright Page: before capture, act, Settled Page, after capture,
// Change Record through core. Mirrors packages/ayme/src/actionSequence.ts + pageState.ts.
import {
  StructuralObservationSession, StructuralActionIdFactory, StructuralTree, SyntheticAriaRefFactory,
  PageIdSchema, MonotonicTimeMsSchema, waitForSettled, SETTLED_PAGE_QUIET_MS, SETTLED_PAGE_DEADLINE_MS,
  aiCapture, renderChangeRecord,
} from "./common.mjs";

const now = () => performance.timeOrigin + performance.now(); // epoch ms, sub-ms
const clock = { now: () => MonotonicTimeMsSchema.parse(performance.now()) };

const ACTIVITY_EVENTS = ["transitionrun", "transitionstart", "transitionend", "transitioncancel",
  "animationstart", "animationiteration", "animationend", "animationcancel", "scroll", "resize"];

// In-page watcher: per-document token, coalesces activity per macrotask, ships in-page timestamps.
export const WATCHER = `(() => {
  if (window.__b2Token) return;
  const token = Math.random().toString(36).slice(2);
  window.__b2Token = token;
  const now = () => performance.timeOrigin + performance.now();
  let batch = [], scheduled = false;
  const notify = (kind, n) => {
    batch.push([now(), kind, n || 1]);
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      const events = batch; batch = [];
      const fn = window.__b2Activity;
      if (typeof fn === "function") fn({ token, url: location.href, sentAt: now(), events });
    }, 0);
  };
  const start = () => {
    new MutationObserver((records) => notify("mutation", records.length)).observe(document.documentElement,
      { attributes: true, childList: true, characterData: true, subtree: true });
    for (const e of ${JSON.stringify(ACTIVITY_EVENTS)}) {
      document.addEventListener(e, () => notify(e), { capture: true, passive: true });
      window.addEventListener(e, () => notify(e), { capture: true, passive: true });
    }
    notify("armed");
  };
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})()`;

let pageCount = 0;

/** Install before the first goto: binding + init script (re-armed in every new document). */
export async function installNodeObserver(context, page) {
  const listeners = new Set();
  const log = []; // every batch with Node receipt time
  await page.exposeFunction("__b2Activity", (msg) => {
    const receivedAt = now();
    const entry = { ...msg, receivedAt };
    log.push(entry);
    for (const l of listeners) l(entry);
  });
  await context.addInitScript(WATCHER);
  const pageId = PageIdSchema.parse(`node_page_${++pageCount}`);
  const session = new StructuralObservationSession({ clock });
  session.recordNavigation({ pageId, url: "about:blank", cause: "initial" });
  return {
    page, pageId, session, log, listeners,
    refFactory: new SyntheticAriaRefFactory(),
    actionIds: new StructuralActionIdFactory(),
    latest: undefined,
    cursor: undefined, // what the Caller last received
  };
}

function record(state, tree, extra = {}) {
  const at = clock.now();
  const entry = state.session.recordObservation({
    kind: "observation", at, pageId: state.pageId,
    tree: { pageId: state.pageId, capturedAt: at, resolve: async () => tree }, ...extra,
  });
  state.latest = { entry, tree };
  return entry;
}

/** The Caller's "snapshot": capture, record, move the cursor. */
export async function nodeSnapshot(state) {
  const { tree, yaml } = await aiCapture(state.page, state.refFactory);
  state.cursor = record(state, tree);
  return yaml;
}

/** Activity source for one document: only batches carrying its token count. */
function activityFor(state, token, onBatch) {
  return {
    subscribe(onActivity) {
      const l = (msg) => { if (msg.token === token) { onBatch?.(msg); onActivity(); } };
      state.listeners.add(l);
      return () => state.listeners.delete(l);
    },
  };
}

function watchFullLoad(state, t0, token) {
  const page = state.page;
  const signals = {};
  let resolve; const started = new Promise((r) => (resolve = r));
  const onRequest = (req) => {
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
      signals.navigationRequest ??= now() - t0;
      resolve(req.url());
    }
  };
  const onNav = (frame) => { if (frame === page.mainFrame()) signals.framenavigated ??= now() - t0; };
  const onBatch = (msg) => { if (msg.token !== token) signals.newDocumentArmed ??= now() - t0; };
  page.on("request", onRequest); page.on("framenavigated", onNav); state.listeners.add(onBatch);
  return { started, signals, stop() { page.off("request", onRequest); page.off("framenavigated", onNav); state.listeners.delete(onBatch); } };
}

async function readChangeRecord(state, received, before, after) {
  const start = before ?? after;
  const [cb, ch] = await Promise.all([
    received && received !== start ? state.session.readChange(state.pageId, received, start) : undefined,
    state.session.readChange(state.pageId, start, after),
  ]);
  const beforeChanged = cb?.hasAnyChanges() ?? false;
  const actionChanged = ch.hasAnyChanges();
  return {
    page_changed: beforeChanged || actionChanged,
    ...(beforeChanged ? { changes_before: renderChangeRecord(cb) } : {}),
    ...(actionChanged ? { changes: renderChangeRecord(ch) } : {}),
  };
}

/** runAction over a Page. Returns { result, timing } where result is the ActionResult shape. */
export async function nodeRunAction(state, perform, { loadingAfter = "capture" } = {}) {
  const t0 = now();
  const timing = { t0Epoch: t0 };
  const logStart = state.log.length;
  const token = await state.page.evaluate(() => window.__b2Token);
  const actionId = state.actionIds.create();
  state.session.recordActionStarted({ kind: "action-started", at: clock.now(), pageId: state.pageId, actionId });
  const received = state.cursor;
  let before = state.latest?.entry;
  // Before capture, recorded only when it differs from the latest observation.
  const cap = await aiCapture(state.page, state.refFactory);
  if (StructuralTree.reconcile(state.latest.tree, cap.tree).hasAnyChanges())
    before = record(state, cap.tree, { capturedForActionId: actionId, relation: "before" });
  timing.beforeCaptured = now() - t0;
  const batches = [];
  const fullLoad = watchFullLoad(state, t0, token);
  let stable = false, loadingUrl;
  const settledP = (async () => {
    await perform();
    timing.performed = now() - t0;
    ({ stable } = await waitForSettled({
      activity: activityFor(state, token, (m) => batches.push(m)),
      clock, quietMs: SETTLED_PAGE_QUIET_MS, deadlineMs: SETTLED_PAGE_DEADLINE_MS,
    }));
    timing.settled = now() - t0;
  })();
  try {
    loadingUrl = await Promise.race([settledP.then(() => undefined), fullLoad.started]);
    if (loadingUrl !== undefined) settledP.catch(() => {});
  } finally { fullLoad.stop(); }
  timing.loadSignals = fullLoad.signals;

  if (loadingUrl !== undefined) {
    timing.loadingNoticed = now() - t0;
    let rec = { page_changed: false };
    let afterCaptureError;
    try {
      // "capture": ask Playwright for the page now; "latest": the old document is going away,
      // so the action's after is the page as last observed (its before).
      const afterTree = loadingAfter === "capture" ? (await aiCapture(state.page, state.refFactory)).tree : state.latest.tree;
      timing.afterCaptured = now() - t0;
      const entry = record(state, afterTree, { capturedForActionId: actionId });
      state.cursor = entry;
      rec = await readChangeRecord(state, received, before, entry);
    } catch (e) { afterCaptureError = String(e.message).split("\n")[0]; }
    state.session.recordActionCompleted({ kind: "action-completed", at: clock.now(), pageId: state.pageId, actionId });
    timing.answered = now() - t0;
    return {
      result: { ...rec, settled: false, loading: loadingUrl,
        next: `The page is loading ${loadingUrl}. Call snapshot next to read the new page.` },
      timing, batches, afterCaptureError, token, settledP, window: state.log.slice(logStart),
    };
  }
  await settledP;
  const after = await aiCapture(state.page, state.refFactory);
  const entry = record(state, after.tree, { capturedForActionId: actionId });
  state.session.recordActionCompleted({ kind: "action-completed", at: clock.now(), pageId: state.pageId, actionId });
  state.cursor = entry;
  const rec = await readChangeRecord(state, received, before, entry);
  timing.answered = now() - t0;
  return { result: { page_changed: rec.page_changed, settled: stable, ...rec }, timing, batches, token, window: state.log.slice(logStart) };
}

export { now };
