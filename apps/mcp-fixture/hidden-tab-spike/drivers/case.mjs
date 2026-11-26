/* global console, process */
// Runs one hidden-tab case n times after a warm-up Run: reset, start
// `ayme call HiddenTabPage.hideThen`, hide the Tab, wait for the call or a
// stall, show the Tab again, and print what each part of the Run did.
// Usage: node case.mjs <endpoint> <way> <step> [n] [stallMs] [preHide]
//   way: popup | tab (the action hides its own Tab), switch | switch-auto |
//        minimise | cover (the driver hides it 400 ms into the action's
//        1.5 s wait), none.
//   preHide: "pre" hides the Tab before the call starts (way switch only).
import {
  ab,
  ayme,
  callAsync,
  cdp,
  events,
  logLines,
  pw,
  sleep,
} from "./lib.mjs";

const [endpoint, way, step, n = "3", stallMs = "12000", preHide] =
  process.argv.slice(2);
const automation = process.env.SPIKE_AUTOMATION; // pw | ab | undefined
const browser = await cdp(endpoint);
const first = await browser
  .find("hidden-tab-spike/index.html")
  .then((t) => t ?? browser.find(":8766/"));
if (!first) throw new Error("No tab shows the test page.");
const hideOf = { popup: "popup", tab: "tab", none: "none" }[way] ?? "wait";

async function others() {
  return (await browser.pages()).filter((t) => t.targetId !== first.targetId);
}

/** Hides the first Tab the driver's way; resolves with how. */
async function hide() {
  if (way === "switch") {
    await browser.send("Target.createTarget", { url: "about:blank" });
    return "cdp Target.createTarget (new tab, in front)";
  }
  if (way === "switch-auto") {
    if (automation === "pw")
      return `pw ${pw("tab-new", "about:blank").out.split("\n")[0]}`;
    if (automation === "ab")
      return `ab ${ab("tab", "new", "about:blank").out.split("\n")[0]}`;
  }
  if (way === "minimise") {
    await browser.setWindowState(first.targetId, "minimized");
    return "cdp Browser.setWindowBounds minimized";
  }
  if (way === "cover") {
    const { bounds } = await browser.windowOf(first.targetId);
    const { targetId } = await browser.send("Target.createTarget", {
      url: "about:blank",
      newWindow: true,
    });
    const { windowId } = await browser.windowOf(targetId);
    await browser.send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        left: bounds.left - 20,
        top: bounds.top - 20,
        width: bounds.width + 40,
        height: bounds.height + 40,
      },
    });
    return `cdp new window over it (${bounds.width}x${bounds.height})`;
  }
  return undefined;
}

/** Shows the first Tab again: closes what hid it, restores its window. */
async function show() {
  if (way === "minimise")
    await browser.setWindowState(first.targetId, "normal");
  for (const target of await others())
    await browser
      .send("Target.closeTarget", { targetId: target.targetId })
      .catch(() => {});
  await browser
    .send("Target.activateTarget", { targetId: first.targetId })
    .catch(() => {});
  if (automation === "pw") pw("tab-select", "0");
  if (automation === "ab") ab("tab", "0");
}

const rel = (t, t0) => Math.round(t - t0);

for (let i = 0; i <= Number(n); i++) {
  await show();
  await sleep(200);
  const reset = ayme("call", "HiddenTabPage.reset");
  if (reset.code !== 0) console.log("reset failed:", reset.out.slice(0, 200));
  let hiddenBy;
  if (preHide === "pre") {
    hiddenBy = await hide();
    await sleep(300);
  }
  const visBefore = await browser.visibility(first.targetId);
  const from = logLines().length;
  const call = callAsync("HiddenTabPage.hideThen", { hide: hideOf, step });
  let visAtHide;
  if (!preHide && !["popup", "tab", "none"].includes(way)) {
    await sleep(400);
    hiddenBy = await hide();
  }
  await sleep(200);
  visAtHide = await browser.visibility(first.targetId).catch((e) => String(e));
  const tabsAtHide = (await browser.pages()).length;
  let outcome = await Promise.race([
    call.done,
    sleep(Number(stallMs) - (Date.now() - call.startedAt)).then(
      () => undefined
    ),
  ]);
  let stalled = false;
  let shownAt;
  if (!outcome) {
    stalled = true;
    shownAt = Date.now();
    await show();
    outcome = await Promise.race([
      call.done,
      sleep(30_000).then(() => undefined),
    ]);
    if (!outcome) {
      call.child.kill();
      outcome = { code: "killed", out: "", ms: Date.now() - call.startedAt };
    }
  }
  const visAfter = await browser.visibility(first.targetId);
  // The Run's own events: those after this call started.
  await sleep(300);
  const ev = events(from);
  const start = ev.find(
    (e) => e.event === "run-start" && e.name === "HiddenTabPage.hideThen"
  );
  const t0 = start?.t ?? call.startedAt;
  const runEnd = ev.find((e) => e.event === "run-end" && e.run === start?.run);
  const parts = {};
  for (const e of ev.filter(
    (e) => e.event === "phase" && e.run === start?.run
  )) {
    if (e.edge === "start") parts[e.part] = { from: rel(e.t, t0) };
    else if (parts[e.part])
      parts[e.part].ms = rel(e.t, t0) - parts[e.part].from;
  }
  const methodEnd = ev.find(
    (e) => e.event === "method-end" && e.run === start?.run
  );
  const actionEnd = ev.find(
    (e) => e.event === "action-end" && e.run === start?.run
  );
  const calls = ev
    .filter(
      (e) =>
        e.event === "call" && e.run === start?.run && /action/.test(e.phase)
    )
    .map(
      (e) =>
        `${e.call.replace(/^.*?\./, "")}:${e.phase.replace(" (action)", "")}@${rel(e.t, t0)}`
    );
  const vis = ev
    .filter((e) => e.event === "vis")
    .map((e) => `${e.state}@${rel(e.t, t0)}`);
  const page = ayme("page-objects");
  console.log(
    JSON.stringify({
      i: i === 0 ? "warm-up" : i,
      way,
      step,
      hiddenBy,
      visBefore,
      visAtHide,
      tabsAtHide,
      visAfter,
      exit: outcome.code,
      callMs: outcome.ms,
      stalled,
      endAfterShowMs: shownAt && rel(call.startedAt + outcome.ms, shownAt),
      out: outcome.out.replace(/\s+/g, " ").slice(0, 200),
      methodEndMs: methodEnd && rel(methodEnd.t, t0),
      inPageSettleMs: methodEnd && actionEnd && rel(actionEnd.t, methodEnd.t),
      parts: Object.fromEntries(
        Object.entries(parts).map(([k, v]) => [
          k,
          v.ms ?? `open since ${v.from}`,
        ])
      ),
      calls: calls.join(" "),
      vis: vis.join(" "),
      runEnd: runEnd && {
        totalMs: Math.round(runEnd.totalMs),
        discarded: runEnd.discarded,
        error: runEnd.error?.slice(0, 120),
      },
      pageObjects: page.out.replace(/\s+/g, " ").slice(0, 160),
    })
  );
}
await show();
browser.close();
