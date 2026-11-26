/* global console, process */
// The hidden-tab variant at work: a Run whose Tab is hidden mid-Run, then
// the next commands while it stays hidden, then after it is shown again.
// Usage: node end.mjs <endpoint> <way: tab|switch|minimise> [n]
import { ayme, callAsync, cdp, events, logLines, sleep } from "./lib.mjs";

const [endpoint, way, n = "3"] = process.argv.slice(2);
const browser = await cdp(endpoint);
const first = await browser.find(":8766/");
const others = async () =>
  (await browser.pages()).filter((t) => t.targetId !== first.targetId);
async function show() {
  if (way === "minimise")
    await browser.setWindowState(first.targetId, "normal");
  for (const t of await others())
    await browser
      .send("Target.closeTarget", { targetId: t.targetId })
      .catch(() => {});
  await browser
    .send("Target.activateTarget", { targetId: first.targetId })
    .catch(() => {});
}
const timed = (f) => {
  const t = Date.now();
  const r = f();
  return {
    ...r,
    ms: Date.now() - t,
    out: r.out.replace(/\s+/g, " ").slice(0, 150),
  };
};
for (let i = 0; i <= Number(n); i++) {
  await show();
  await sleep(300);
  ayme("call", "HiddenTabPage.reset");
  const from = logLines().length;
  const call = callAsync("HiddenTabPage.hideThen", {
    hide: way === "tab" ? "tab" : way === "during-click" ? "none" : "wait",
    step: way === "during-click" ? "movingclickfill" : "clickfill",
  });
  if (way === "switch" || way === "during-click") {
    await sleep(400);
    await browser.send("Target.createTarget", { url: "about:blank" });
  }
  if (way === "minimise") {
    await sleep(400);
    await browser.setWindowState(first.targetId, "minimized");
  }
  const first_ = await Promise.race([
    call.done,
    sleep(15000).then(() => undefined),
  ]);
  // While still hidden: does the next Run's command wait for the stopped action?
  await sleep(1000);
  const next = timed(() => ayme("call", "HiddenTabPage.mark"));
  const listing = process.env.SKIP_LIST
    ? { code: "skipped", ms: 0, out: "" }
    : timed(() => ayme("page-objects"));
  const shownAt = Date.now();
  await show();
  await sleep(1500);
  const after = timed(() => ayme("call", "HiddenTabPage.mark"));
  const page = ayme("page-objects").out.replace(/\s+/g, " ");
  const ev = events(from);
  const start = ev.find(
    (e) => e.event === "run-start" && e.name === "HiddenTabPage.hideThen"
  );
  const t0 = start?.t ?? call.startedAt;
  const calls = ev
    .filter(
      (e) =>
        e.event === "call" &&
        e.run === start?.run &&
        /action|refused/.test(e.phase)
    )
    .map(
      (e) =>
        `${e.call.replace(/^.*?\./, "")}:${e.phase.replace(" (action)", "")}@${Math.round(e.t - t0)}`
    );
  const runEnd = ev.find((e) => e.event === "run-end" && e.run === start?.run);
  console.log(
    JSON.stringify({
      i: i === 0 ? "warm-up" : i,
      way,
      firstCall: first_
        ? { exit: first_.code, ms: first_.ms, out: first_.out.slice(0, 140) }
        : "no answer in 15 s",
      nextCallWhileHidden: next,
      listingWhileHidden: listing,
      afterShow: after,
      stoppedRunEndAfterShowMs: runEnd && Math.round(runEnd.t - shownAt),
      stoppedRunError: runEnd?.error?.slice(0, 160),
      calls: calls.join(" "),
      vis: ev
        .filter((e) => e.event === "vis")
        .map((e) => `${e.state}@${Math.round(e.t - t0)}`)
        .join(" "),
      page: page.slice(0, 200),
    })
  );
}
await show();
browser.close();
