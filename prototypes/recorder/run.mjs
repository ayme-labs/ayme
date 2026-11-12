// Shared by compare.mjs and record.mjs: one browser, one recording.
import { loadPlaywright, sleep } from "./lib/pw.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Recording } from "./lib/recorder.mjs";
import { MIRROR_INIT_SCRIPT } from "./lib/stamp.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");

export async function openRecording({
  mode,
  version,
  url,
  headed = false,
  onEntry,
  onlyHost,
  trace = false, // record a stock Playwright trace of the whole recording
  stamp = "none", // none | locators | private | mirror, see lib/stamp.mjs
  // false: the caller ends the recording on a signal itself. Playwright's own
  // handlers close the browser and exit the process with 130 at once, before
  // anything could be written.
  playwrightHandlesSignals = true,
}) {
  const { pw, version: real } = loadPlaywright(version);
  // AYME_CHANNEL=chromium runs the full browser in its new headless mode
  // (the same code as headed) instead of the headless shell.
  const browser = await pw.chromium.launch({
    headless: !headed,
    handleSIGINT: playwrightHandlesSignals,
    handleSIGTERM: playwrightHandlesSignals,
    handleSIGHUP: playwrightHandlesSignals,
    ...(process.env.AYME_CHANNEL ? { channel: process.env.AYME_CHANNEL } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
  });
  // keep the browser on one site: anything else the page asks for is dropped
  if (onlyHost)
    await context.route("**/*", (route) =>
      new URL(route.request().url()).hostname.endsWith(onlyHost)
        ? route.continue()
        : route.abort()
    );
  let tracing = null;
  if (trace) {
    fs.mkdirSync(OUT, { recursive: true });
    tracing = { path: path.join(OUT, `tmp-trace-${process.pid}.zip`) };
    if (stamp === "mirror") await context.addInitScript(MIRROR_INIT_SCRIPT);
    await context.tracing.start({
      name: "ayme-recording",
      snapshots: true,
      screenshots: true,
    });
  }
  const page = await context.newPage();
  const recording = new Recording({
    context,
    page,
    mode,
    version: real,
    onEntry,
    trace: tracing,
    stamp,
  });
  await recording.start();
  await page.goto(url);
  await recording.rebaseline(page);
  await sleep(300);
  return { browser, context, page, recording };
}
