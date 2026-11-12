// Record by hand: opens a headed browser and records until you press Enter in
// the terminal, close the last page, close the browser or interrupt.
// usage: node record.mjs --mode after|before|gate-a|gate-b [--url <url>] [--pw 1.65] [--out <file.json>] [--headless]
//                        [--package <root>] [--stamp none|private|locators|mirror]
// Without --url it opens the local fixture; `--url edge` opens the gate edge-case page.
// The output file is rewritten after every recorded entry, so an interrupt
// loses nothing. In gate-b mode, `--package <root>` also writes the released
// Recording Package with a stock trace to <root>/.ayme/recordings/<id>/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODES, writeRecording, describeEntry } from "./lib/recorder.mjs";
import { serveFixture } from "./lib/fixture.mjs";
import { savePackage } from "./lib/package.mjs";
import { openRecording } from "./run.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const mode = arg("mode", "gate-b");
if (!MODES.includes(mode))
  throw new Error(`--mode must be one of ${MODES.join(", ")}`);
const packageRoot = arg("package");
if (packageRoot && mode !== "gate-b")
  throw new Error("--package records in gate-b mode only");
const version = arg("pw", "1.65");
const fixture = await serveFixture();
const given = arg("url");
const url = !given
  ? fixture.origin + "/"
  : given === "edge"
    ? fixture.origin + "/edge"
    : given;
const out = arg(
  "out",
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "out",
    `manual-${mode}.json`
  )
);

let recording = null;
// Written without touching the browser, so it works whatever state that is in.
const checkpoint = () => {
  if (recording)
    writeRecording(out, serializable(recording.snapshotOfRecording()));
};
const serializable = ({ model: _model, ...rest }) => rest;

const opened = await openRecording({
  mode,
  version,
  url,
  headed: !process.argv.includes("--headless"),
  onlyHost: arg("only-host"),
  trace: Boolean(packageRoot),
  stamp: arg("stamp", "none"),
  playwrightHandlesSignals: false,
  onEntry: (entry) => {
    console.log("\n" + describeEntry(entry));
    checkpoint();
  },
});
const { browser, context } = opened;
recording = opened.recording;
checkpoint();
console.log(
  `Recording ${url} in mode ${mode} on Playwright ${recording.version}. Press Enter here, or close the page, to stop.`
);

let stopping = false;
const stop = async (why) => {
  if (stopping) return;
  stopping = true;
  // first what is already known, in case the rest cannot finish
  checkpoint();
  console.log(`\nstopping (${why})`);
  // The browser may be gone: never wait on it for longer than this.
  const result = await Promise.race([
    recording.stop().catch((error) => ({ error: String(error) })),
    new Promise((r) => setTimeout(() => r({ timedOut: true }), 8000)),
  ]);
  if (result.entries) writeRecording(out, serializable(result));
  else console.log(`could not finish cleanly: ${JSON.stringify(result)}`);
  console.log(`wrote ${out} and ${out.replace(/\.json$/, ".txt")}`);
  if (packageRoot) {
    const saved = savePackage({
      root: path.resolve(packageRoot),
      result: result.entries ? result : recording.snapshotOfRecording(),
    });
    if (result.traceFile) fs.rmSync(result.traceFile, { force: true });
    console.log(
      saved
        ? `Recording package: ${saved.packagePath}${saved.header.tracePath ? "" : `  (no trace: ${result.traceError ?? "the browser was gone before tracing could stop"})`}`
        : "No recording package: no page was recorded."
    );
  }
  if (result.meta?.gateLagsMs?.length)
    console.log(
      "gate lags (ms):",
      JSON.stringify(
        result.meta.gateLagsMs.map((l) => ({
          kind: l.kind,
          lag: +l.click.toFixed(1),
        }))
      )
    );
  await Promise.race([
    browser.close().catch(() => {}),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  fixture.close();
  process.exit(0);
};
process.stdin.once("data", () => stop("Enter"));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, () => stop(signal));
browser.on("disconnected", () => stop("the browser closed"));
// On macOS the browser keeps running without a window: the last page closing
// ends the recording.
const watchClose = (page) =>
  page.on("close", () => {
    if (context.pages().length === 0) stop("the last page closed");
  });
context.on("page", watchClose);
for (const page of context.pages()) watchClose(page);
// to try the above without a person: AYME_CLOSE_PAGES_AFTER=<ms>
if (process.env.AYME_CLOSE_PAGES_AFTER)
  setTimeout(
    () => context.pages().forEach((page) => page.close()),
    Number(process.env.AYME_CLOSE_PAGES_AFTER)
  );
