import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "../lib/pw.mjs";
import { Recording, writeRecording } from "../lib/recorder.mjs";
import { reconcile } from "../lib/core.mjs";
import { savePackage } from "../lib/package.mjs";
import { serveFixture } from "../lib/fixture.mjs";
import { installPageUI } from "./page.mjs";
import { effects, projectEntry } from "./model.mjs";

export async function startTrial({
  version = "1.65",
  url,
  headed = true,
  out = new URL("./out/", import.meta.url).pathname,
} = {}) {
  fs.mkdirSync(out, { recursive: true });
  const fixture = await serveFixture();
  const { pw, version: real } = loadPlaywright(version);
  const browser = await pw.chromium.launch({
    headless: !headed,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
  });
  let highlightSequence = 0;
  let state = { type: "state", phase: "recording", mode: "recording" },
    recording,
    pwRecorder,
    finishPromise;
  const clients = new Set(),
    journal = [],
    current = new Map(),
    sessions = new Map();
  const emit = (event) => {
    journal.push(event);
    if (event.type === "entry") current.set(event.id, event);
    if (event.type === "remove") current.delete(event.id);
    for (const c of clients) c.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  // CDP bypasses Playwright instrumentation: state delivery adds no trace actions.
  async function inPages(expression) {
    await Promise.all(
      [...sessions.values()].flatMap(({ cdp, worlds }) =>
        [...worlds].map((contextId) =>
          cdp
            .send("Runtime.evaluate", { expression, contextId })
            .catch(() => {})
        )
      )
    );
  }
  const publishState = async () => {
    emit(state);
    await inPages(`window.__aymeWindowState?.(${JSON.stringify(state)})`);
  };
  const onPage = async (page) => {
    const cdp = await context.newCDPSession(page),
      worlds = new Set();
    sessions.set(page, { cdp, worlds });
    cdp.on("Runtime.executionContextCreated", ({ context: c }) => {
      if (!c.auxData?.isDefault) return;
      worlds.add(c.id);
      cdp
        .send("Runtime.evaluate", {
          contextId: c.id,
          expression: `window.__aymeWindowState?.(${JSON.stringify(state)})`,
        })
        .catch(() => {});
    });
    cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }) =>
      worlds.delete(executionContextId)
    );
    cdp.on("Runtime.executionContextsCleared", () => worlds.clear());
    await cdp.send("Runtime.enable");
  };
  await context.exposeBinding("__aymeWindowGetState", () => state);
  await context.exposeBinding("__aymeWindowCommand", (_source, name) =>
    command(name)
  );
  await context.exposeBinding("__aymeWindowDirty", ({ page }) => {
    if (state.phase !== "recording" || !recording) return;
    recording.enqueue(async () => {
      const visit = recording.state(page).visits.at(-1);
      if (!visit?.last || page.isClosed()) return;
      const snap = await recording.snap(page),
        rows = effects(reconcile(visit.last.tree, snap.tree));
      const id = `pending:${visit.visitId}`;
      if (rows.length)
        emit({
          type: "entry",
          id,
          visit: { id: visit.visitId, url: visit.url },
          title: "Change without interaction (pending)",
          rows,
        });
      else if (current.has(id)) emit({ type: "remove", id });
    });
  });
  await context.addInitScript(installPageUI);
  await context.tracing.start({ snapshots: true, screenshots: true });
  const page = await context.newPage();
  await onPage(page);
  context.on("page", (p) => onPage(p).catch(console.error));
  recording = new Recording({
    context,
    page,
    mode: "gate-b",
    version: real,
    trace: { path: path.join(out, "trace.zip") },
    onEntry: (publicEntry) => {
      const entry = recording.entries[publicEntry.index];
      if (!entry?.pkg) return;
      emit({ type: "remove", id: `pending:${entry.pkg.visit.visitId}` });
      // A replaced interaction also replaces (or removes) its preceding change.
      emit({ type: "remove", id: `before:${entry.interactionId}` });
      for (const e of projectEntry(entry)) emit({ type: "entry", ...e });
    },
  });
  await recording.start();
  // Same in-process connection as the snapshots: never use refs across connections.
  const impl = context._connection.toImpl(context);
  const symbol = Object.getOwnPropertySymbols(impl).find(
    (s) => s.description === "recorderSymbol"
  );
  pwRecorder = await impl[symbol];
  if (!pwRecorder?.setMode) throw Error("Stock recorder mode seam changed");
  pwRecorder.on("modeChanged", (mode) => {
    state = { ...state, mode };
    publishState().catch(console.error);
  });
  state = { ...state, mode: pwRecorder.mode() };

  async function command(name, args = {}) {
    if (name === "finish") return finish();
    if (state.phase !== "recording") throw Error("Recording has finished");
    if (name === "assert") {
      await pwRecorder.setMode("assertingVisibility");
      return { status: "Pick an element on the recorded page" };
    }
    if (name === "highlight") {
      const sequence = ++highlightSequence;
      await inPages("window.__aymeWindowDraw?.(null)");
      if (!args.visitId) return { status: "" };
      const visit = recording.visits.find((v) => v.visitId === args.visitId);
      if (
        !visit ||
        visit.page.isClosed() ||
        recording.state(visit.page).visits.at(-1) !== visit
      )
        return { status: "Element belongs to an earlier visit" };
      if (!args.selector && !/^(f\d+)*e\d+$/.test(args.ref ?? ""))
        return { status: "No live browser ref for this node" };
      const locator = visit.page.locator(
        args.selector || `aria-ref=${args.ref}`
      );
      if ((await locator.count()) !== 1)
        return { status: "Element is gone or ambiguous" };
      const rect = await locator
        .boundingBox({ timeout: 500 })
        .catch(() => null);
      if (sequence !== highlightSequence) return { status: "" };
      const session = sessions.get(visit.page);
      // Draw the page-coordinate box only in its top frame.
      await session.cdp.send("Runtime.evaluate", {
        expression: `window.__aymeWindowDraw?.(${JSON.stringify(rect)})`,
      });
      return { status: rect ? "" : "Element is not visible" };
    }
    throw Error("Unknown command");
  }
  async function finish() {
    if (finishPromise) return finishPromise;
    finishPromise = (async () => {
      state = { ...state, phase: "finishing" };
      await publishState();
      const result = await recording.stop();
      for (const v of recording.visits)
        if (v.trailing)
          emit({
            type: "entry",
            id: `pending:${v.visitId}`,
            visit: { id: v.visitId, url: v.url },
            title: "Change without interaction",
            rows: effects(v.trailing.changeTree),
          });
      const { model, ...json } = result;
      writeRecording(path.join(out, "recording.json"), json);
      const saved = savePackage({ root: out, result });
      state = { ...state, phase: "finished", mode: "none" };
      await publishState();
      fs.writeFileSync(
        path.join(out, "events.json"),
        JSON.stringify(journal, null, 2)
      );
      console.log(`Finished: ${saved?.packagePath ?? out}`);
      return { status: `Written to ${out}` };
    })();
    return finishPromise;
  }
  const server = http.createServer(async (req, res) => {
    // Loopback only; reject browser cross-origin commands (including DNS rebinding).
    const host = `127.0.0.1:${server.address().port}`;
    if (
      req.headers.host !== host ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)
    ) {
      res.writeHead(403).end();
      return;
    }
    if (req.url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      res.write(`data: ${JSON.stringify(state)}\n\n`);
      for (const e of current.values())
        res.write(`data: ${JSON.stringify(e)}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.url === "/command" && req.method === "POST") {
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 10000) throw Error("Command too large");
        }
        const args = JSON.parse(body),
          result = await command(args.command, args);
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(result));
      } catch (e) {
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (req.url !== "/") {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, { "content-type": "text/html" })
      .end(fs.readFileSync(new URL("./index.html", import.meta.url)));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const windowUrl = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url ?? fixture.origin);
  await recording.rebaseline(page);
  await publishState();
  console.log(
    `Recorder window: ${windowUrl}\nRecording: ${page.url()} (Playwright ${real})`
  );
  const close = async () => {
    if (state.phase === "recording") await finish();
    for (const c of clients) c.end();
    await browser.close();
    server.close();
    fixture.close();
  };
  return {
    browser,
    context,
    page,
    recording,
    windowUrl,
    command,
    finish,
    close,
    journal,
    state: () => state,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf("--" + name);
    return i < 0 ? fallback : process.argv[i + 1];
  };
  const trial = await startTrial({
    version: arg("pw", "1.65"),
    url: arg("url"),
    headed: !process.argv.includes("--headless"),
    out: arg("out"),
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => trial.close().then(() => process.exit(0)));
  trial.context.on("page", (p) =>
    p.on("close", () => {
      if (!trial.context.pages().length) trial.close();
    })
  );
  trial.page.on("close", () => {
    if (!trial.context.pages().length) trial.close();
  });
  console.log(
    "Open the window URL in your browser. Finish writes output; Ctrl+C then closes the trial."
  );
}
