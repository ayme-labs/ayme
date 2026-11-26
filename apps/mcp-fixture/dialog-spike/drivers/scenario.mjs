/* global console, process, setTimeout, URL */
// Runs one dialog case N times: reset, `ayme call <tool>`, answer the dialog
// with the automation, wait for the Run to end, read the page.
// Usage: node scenario.mjs <pw|ab> <tool> <accept|dismiss|none> [n] [promptText]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [automation, tool, answer, n = "1", promptText] = process.argv.slice(2);
const R = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");
// A scratch folder: the log, the cache, the Playwright CLI working folder and its config.json.
const S = process.env.SPIKE_SCRATCH;
if (!S) throw new Error("Set SPIKE_SCRATCH to a scratch folder.");
const LOG = `${S}/spike.log`;
const env = {
  ...process.env,
  AYME_CACHE_DIR: `${S}/cache`,
  AYME_SPIKE_LOG: LOG,
};

function run(file, args, cwd) {
  try {
    return {
      code: 0,
      out: execFileSync(file, args, {
        cwd,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      }),
    };
  } catch (error) {
    return {
      code: error.status,
      out: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}
const ayme = (...args) =>
  run(
    "node",
    [`${R}/packages/mcp/dist/cli.mjs`, ...args],
    `${R}/apps/mcp-fixture/dialog-spike`
  );
const pw = (...args) =>
  run(
    `${R}/apps/eval-formbricks/node_modules/.bin/playwright-cli`,
    ["-s=dialogspike", ...args],
    `${S}/pwcli`
  );
const ab = (...args) =>
  run(`${R}/apps/eval-formbricks/node_modules/.bin/agent-browser`, [
    "--session",
    "dialogspike",
    ...args,
  ]);

function answerDialog() {
  if (automation === "pw")
    return answer === "accept"
      ? pw("dialog-accept", ...(promptText ? [promptText] : []))
      : pw("dialog-dismiss");
  return answer === "accept"
    ? ab("dialog", "accept", ...(promptText ? [promptText] : []))
    : ab("dialog", "dismiss");
}

const events = (from) =>
  readFileSync(LOG, "utf8")
    .split("\n")
    .slice(from)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const lines = () =>
  readFileSync(LOG, "utf8").split("\n").filter(Boolean).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < Number(n); i++) {
  ayme("call", "DialogPage.reset");
  const from = lines();
  const callStart = Date.now();
  const call = ayme("call", tool);
  const callMs = Date.now() - callStart;
  let sentAt, answered;
  if (answer !== "none") {
    sentAt = Date.now();
    answered = answerDialog();
  }
  // Wait for the Run of the call to end.
  let runEnd;
  for (let waited = 0; waited < 20_000; waited += 50) {
    runEnd = events(from).find((e) => e.event === "run-end" && e.name === tool);
    if (runEnd) break;
    await sleep(50);
  }
  const tree = ayme("page-objects");
  const ev = events(from);
  const closed = ev.find((e) => e.event === "cdp-closed");
  const pwClosed = ev.find((e) => e.event === "pw-dialogclosed");
  const actionEnd = ev.find(
    (e) => e.event === "action-end" && e.run === runEnd?.run
  );
  const methodEnd = ev.find(
    (e) => e.event === "method-end" && e.run === runEnd?.run
  );
  const calls = ev
    .filter(
      (e) =>
        e.event === "call" && e.run === runEnd?.run && /action/.test(e.phase)
    )
    .map((e) => `${e.call}:${e.phase.replace(" (action)", "")}`);
  console.log(
    JSON.stringify({
      i,
      callExit: call.code,
      callMs,
      call: call.out.trim().slice(0, 160),
      answerCmd:
        answered &&
        answered.out.trim().split("\n").slice(0, 2).join(" | ").slice(0, 120),
      sentToCdpClosedMs: closed && sentAt && Math.round(closed.t - sentAt),
      cdpClosed: closed && {
        result: closed.result,
        userInput: closed.userInput,
        reported: closed.reported,
      },
      pwClosedBeforeCdpMs:
        pwClosed && closed && Number((closed.t - pwClosed.t).toFixed(1)),
      calls: calls.join(", "),
      method: methodEnd?.outcome.slice(0, 100),
      answeredToMethodEndMs: methodEnd?.answeredToMethodEndMs,
      answeredToActionEndMs: actionEnd?.answeredToActionEndMs,
      answeredToRunEndMs: runEnd?.answeredToEndMs,
      runOutcome:
        runEnd && (runEnd.error ?? runEnd.outcome?.text ?? "").slice(0, 160),
      page: tree.out
        .split("\n")
        .slice(1, 3)
        .map((l) => l.trim())
        .join(" ; "),
    })
  );
}
