import assert from "node:assert/strict";
import fs from "node:fs";
import { startTrial } from "./trial.mjs";
import { createHuman } from "../lib/human.mjs";
import { sleep } from "../lib/pw.mjs";
const version = process.argv[2] ?? "1.65";
const t = await startTrial({
  version,
  headed: process.argv.includes("--headed"),
  out: new URL(`./out/pw-${version}/`, import.meta.url).pathname,
});
try {
  const { page, context, recording } = t,
    h = await createHuman(context, page);
  const wait = async () => {
    await sleep(1600);
    await recording.queue;
  };
  const uiContext = await t.browser.newContext();
  const ui = await uiContext.newPage();
  await ui.goto(t.windowUrl);
  const uh = await createHuman(uiContext, ui);
  const before = await page.ariaSnapshot({ mode: "ai" });
  assert(!before.includes("Assert visibility") && !before.includes("Finish"));
  const layout = await page.locator("main").boundingBox();
  await h.clickOn(page.locator("#name"));
  await h.type("a");
  await wait();
  const focus = await page.evaluate(() => document.activeElement.id);
  const cycleCount = recording.state(page).cycles.length;
  // Toolbar coordinates are fixed, even though its shadow is deliberately closed.
  const toolbarButton = async (name) => {
    const b = await page.evaluate(
      (name) =>
        window.__aymeWindowInspect().buttons.find((b) => b.command === name)
          .rect,
      name
    );
    if (name === "assert") await context.tracing.group("probe-toolbar-mode");
    await h.click(b.x + b.width / 2, b.y + b.height / 2);
    if (name === "assert") {
      await sleep(300);
      await context.tracing.groupEnd();
    }
  };
  await toolbarButton("assert");
  await sleep(400);
  assert.equal(t.state().mode, "assertingVisibility");
  assert.equal(await page.evaluate(() => document.activeElement.id), focus);
  assert.equal(recording.state(page).cycles.length, cycleCount);
  const pos = await h.centre(page.locator("#other"));
  await h.move(...pos);
  await sleep(100);
  assert.match(
    await page.evaluate(() => window.__aymeWindowInspect().box),
    /display: block/
  );
  await h.click(...pos);
  await wait();
  assert(recording.entries.some((e) => e.action.name === "assertVisible"));
  assert.equal(
    recording.state(page).cycles.length,
    cycleCount,
    "assert pick bypasses gate"
  );
  await h.clickOn(page.locator("#name"));
  await wait();
  await h.type("b");
  await wait();
  await h.type("c");
  await wait();
  assert(t.journal.some((e) => e.type === "entry" && e.title === "Fill 'abc'"));
  const ids = t.journal
    .filter((e) => e.title?.startsWith("Fill '"))
    .map((e) => e.id);
  assert(ids.length > new Set(ids).size, "typing updated an existing entry");
  for (const locator of [
    page.locator("#other"),
    page.frameLocator("#frame").locator("#inner"),
    page.locator("#shadowBtn"),
  ]) {
    await h.clickOn(locator);
    await wait();
    const entry = recording.entries.findLast((e) => e.action.name === "click");
    assert(entry.pkg.target.ref);
    await context.tracing.group("probe-highlight");
    const result = await t.command("highlight", {
      visitId: entry.pkg.visit.visitId,
      ref: entry.pkg.target.ref,
    });
    await context.tracing.groupEnd();
    assert.equal(result.status, "");
  }
  assert.deepEqual(await page.locator("main").boundingBox(), layout);
  await h.clickOn(page.locator("#notify"));
  await sleep(3200);
  await recording.queue;
  assert(
    t.journal.some(
      (e) =>
        e.id?.startsWith("pending:") &&
        e.rows?.some((r) => r.element.text.includes("Saved"))
    )
  );
  await h.clickOn(page.locator("#dismiss"));
  await wait();
  const removed = recording.entries.findLast((e) => e.action.name === "click");
  assert.match(
    (
      await t.command("highlight", {
        visitId: removed.pkg.visit.visitId,
        ref: removed.pkg.target.ref,
      })
    ).status,
    /gone/
  );
  assert(
    !(await page.ariaSnapshot({ mode: "ai" })).includes("Assert visibility")
  );
  assert(
    !recording.entries.some((e) =>
      e.action.selector?.includes("ayme-recorder-trial")
    )
  );
  await ui.locator("article").first().waitFor();
  const updated = t.journal.findLast((e) => e.title === "Fill 'abc'");
  assert.equal(await ui.locator(`article[data-id="${updated.id}"]`).count(), 1);
  const articleCount = await ui.locator("article").count();
  assert(articleCount > 3);
  const firstBadge = ui
    .locator("article .badge")
    .filter({ hasText: "Shadow button" })
    .first();
  if (await firstBadge.count()) {
    const xy = await uh.centre(firstBadge);
    await uh.move(...xy);
    await sleep(200);
  }
  await h.cdp.send("Page.navigate", { url: new URL("/two", page.url()).href });
  await page.waitForURL("**/two");
  await recording.rebaseline(page);
  await wait();
  await uh.clickOn(ui.locator("#assert"));
  await sleep(400);
  assert.equal(t.state().mode, "assertingVisibility");
  await h.clickOn(page.locator("#b2"));
  await wait();
  assert.equal(await ui.locator("main section").count(), 2);
  if (version === "1.62") await toolbarButton("finish");
  else await uh.clickOn(ui.locator("#finish"));
  for (let i = 0; i < 40 && t.state().phase !== "finished"; i++)
    await sleep(100);
  await t.finish();
  await uiContext.close();
  assert.equal(t.state().phase, "finished");
  fs.writeFileSync(
    new URL(`./out/probe-${version}.json`, import.meta.url),
    JSON.stringify(
      {
        version,
        asserts: recording.entries.filter(
          (e) => e.action.name === "assertVisible"
        ).length,
        cycles: recording.state(page).cycles.length,
        events: t.journal.length,
        typingIds: ids,
        removedHighlight: "gone",
        iframeHighlight: true,
        shadowHighlight: true,
        focusPreserved: true,
        layoutPreserved: true,
      },
      null,
      2
    )
  );
  console.log("PASS", version);
} finally {
  await t.close();
}
