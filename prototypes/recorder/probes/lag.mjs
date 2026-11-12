// Question 3, the added input lag: from the human's click (or keydown) to the
// moment the page receives the re-sent one. Measured in the page, on the small
// fixture and on a large page (2000 table rows, about 12 000 elements).
// usage: node probes/lag.mjs [version]
import { sleep } from "../lib/pw.mjs";
import { serveFixture } from "../lib/fixture.mjs";
import { createHuman } from "../lib/human.mjs";
import { openRecording } from "../run.mjs";

const version = process.argv[2] ?? "1.65";
const fixture = await serveFixture();
const stats = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return {
    n: xs.length,
    min: +sorted[0].toFixed(1),
    median: +sorted[Math.floor(xs.length / 2)].toFixed(1),
    max: +sorted.at(-1).toFixed(1),
  };
};
const out = { version };
// `pace` is the pause between inputs. At 500 ms on the large page the next
// input arrives while the previous interaction's after-snapshot still runs.
const pace = Number(process.argv[3] ?? 2000);
out.paceMs = pace;
for (const [pageName, route, target] of [
  ["small fixture", "/", "#other"],
  ["large page", "/big", "#go"],
]) {
  for (const mode of ["gate-a", "gate-b"]) {
    const { browser, context, page, recording } = await openRecording({
      mode,
      version,
      url: fixture.origin + route,
    });
    const human = await createHuman(context, page);
    const snapshotMs = [];
    for (let i = 0; i < 5; i += 1) {
      const t = Date.now();
      await page.ariaSnapshot({ mode: "ai" });
      snapshotMs.push(Date.now() - t);
    }
    for (let i = 0; i < 10; i += 1) {
      await human.clickOn(page.locator(target));
      await sleep(pace);
    }
    await page.locator(target).focus();
    for (let i = 0; i < 6; i += 1) {
      await human.key("F8");
      await sleep(pace);
    }
    const count = await page
      .locator(target === "#go" ? "#count" : "#otherCount")
      .textContent();
    const result = await recording.stop();
    const lags = result.meta.gateLagsMs;
    out[`${pageName}, ${mode}`] = {
      "page.ariaSnapshot({mode:'ai'}) alone, ms": stats(snapshotMs),
      "click lag, ms (human click -> page gets the re-sent click)": stats(
        lags.filter((l) => l.kind === "click").map((l) => l.click)
      ),
      ...(mode === "gate-a"
        ? {
            "press lag, ms (human pointerdown -> page gets a pointerdown; includes the 70 ms the simulated human holds the button)":
              stats(lags.filter((l) => l.kind === "click").map((l) => l.press)),
          }
        : {}),
      "key lag, ms": stats(
        lags.filter((l) => l.kind === "key").map((l) => l.click)
      ),
      "clicks counted by the page (10 sent)": count,
      "actions recorded": result.entries.filter(
        (e) => e.action.name !== "navigate"
      ).length,
    };
    await browser.close();
  }
}
fixture.close();
console.log(JSON.stringify(out, null, 1));
