// Records a scripted flow in gate-b mode and writes it as the released
// Recording Package with a stock trace.
// usage: node record-package.mjs [--flow saucedemo-cart] [--pw 1.65] [--root <dir>] [--stamp none|locators|private|mirror] [--headed]
// The package lands in <root>/.ayme/recordings/<id>/ (default root: skill-check/).
// What the released code needs to check it lands in out/package/<id>/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeEntry } from "./lib/recorder.mjs";
import { serveFixture } from "./lib/fixture.mjs";
import { createHuman } from "./lib/human.mjs";
import { flows, stepper } from "./lib/flows.mjs";
import { savePackage } from "./lib/package.mjs";
import { openRecording } from "./run.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const flowName = arg("flow", "saucedemo-cart");
const flow = flows[flowName];
if (!flow) throw new Error(`unknown flow ${flowName}`);
const root = path.resolve(arg("root", path.join(here, "skill-check")));
const stamp = arg("stamp", "none");

const fixture = await serveFixture();
const { browser, context, page, recording } = await openRecording({
  mode: "gate-b",
  version: arg("pw", "1.65"),
  url: flow.url(fixture.origin),
  headed: process.argv.includes("--headed"),
  onlyHost: flow.onlyHost,
  trace: true,
  stamp,
});
console.log(
  `== ${flowName} in gate-b on Playwright ${recording.version}, stamp: ${stamp}`
);
const human = await createHuman(context, page);
const { step } = stepper(console.log);
await flow.run({
  page,
  human,
  step: (name, fn, wait) => {
    recording.label = name;
    return step(name, fn, wait);
  },
});
const result = await recording.stop();
await browser.close();
fixture.close();

const saved = savePackage({ root, result });
if (result.traceFile) fs.rmSync(result.traceFile, { force: true });
if (!saved) throw new Error("nothing recorded: no visit");

// For check-package.mjs: the released recorder validates a JSON document and
// renders the text from core trees; neither is part of the stored package.
const side = path.join(here, "out", "package", saved.recordingId);
fs.mkdirSync(side, { recursive: true });
fs.writeFileSync(
  path.join(side, "document.json"),
  JSON.stringify(saved.document, null, 1)
);
fs.writeFileSync(
  path.join(side, "recording.json"),
  JSON.stringify(
    {
      flow: flowName,
      root,
      packagePath: saved.packagePath,
      meta: result.meta,
      traceError: result.traceError,
      traceStats: saved.traceStats,
      traceLookup: saved.traceLookup,
      tracePoints: result.model.tracePoints,
      interactions: result.model.visits.flatMap((visit) =>
        visit.timelineEntries
          .filter((e) => e.kind === "interaction")
          .map((e) => ({
            visitId: visit.visitId,
            id: e.interaction.id,
            type: e.interaction.type,
            targetRef: e.interaction.targetRef,
            targetExact: e.targetExact,
            leftVisit: e.leftVisit,
          }))
      ),
      entries: result.entries,
    },
    null,
    1
  )
);
fs.writeFileSync(
  path.join(side, "entries.txt"),
  result.entries.map(describeEntry).join("\n\n") + "\n"
);
// The released renderer runs over the very trees this recording holds.
if (process.argv.includes("--check")) {
  const { checkAgainstReleased } = await import("./check-package.mjs");
  await checkAgainstReleased({ result, saved, side });
}
console.log(`Recording package: ${saved.packagePath}`);
console.log(`check inputs: ${side}`);
