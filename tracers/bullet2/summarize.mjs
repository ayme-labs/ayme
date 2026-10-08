import { readFileSync } from "node:fs";
const o = JSON.parse(readFileSync(new URL("./out.json", import.meta.url)));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const rng = (a) => `med ${med(a)?.toFixed(1)} [${Math.min(...a).toFixed(1)}..${Math.max(...a).toFixed(1)}]`;
const strip = (r) => r && JSON.stringify({ ...r }, null, 1);
for (const k of ["increment", "unmount", "mount", "navigate_capture", "navigate_latest"]) {
  const n = o.node[k];
  console.log(`\n===== NODE ${k}: answered ${rng(n.map((x) => x.timing.answered))}, performed ${rng(n.map((x) => x.timing.performed ?? NaN))}, settled-at ${rng(n.map((x) => x.timing.settled ?? NaN))}`);
  const distinct = [...new Set(n.map((x) => JSON.stringify({ ...x.result, loading: x.result.loading && "<url>", next: x.result.next && "<next>" })))];
  console.log("distinct results:", distinct.length); console.log(JSON.parse(distinct[0]).changes ?? "(no changes)"); console.log(JSON.stringify({...JSON.parse(distinct[0]), changes: undefined}));
  if (n[0].timing.loadSignals) console.log("loadSignals", n.map((x) => JSON.stringify(x.timing.loadSignals)).join(" | "), "afterCaptured", n.map(x=>x.timing.afterCaptured?.toFixed(1)).join(","), "errs", n.map(x=>x.afterCaptureError).join(","));
}
for (const k of ["increment", "unmount", "mount"]) {
  const b = o.browser[k];
  const ms = b.map((x) => x.ms ?? x.answeredMs);
  console.log(`\n===== BROWSER ${k}: ${rng(ms.filter((x) => x != null))}`);
  const distinct = [...new Set(b.map((x) => JSON.stringify(x.result ? { ...x.result, loading: x.result.loading && "<url>", next: x.result.next && "<next>" } : x.error)))];
  console.log("distinct results:", distinct.length); for (const d of distinct) { const p = JSON.parse(d); console.log(p?.changes ?? p); console.log(JSON.stringify({ ...p, changes: undefined })); }
  if (k === "navigate") console.log(b.map((x) => `framenav ${x.framenavigatedMs?.toFixed(1)} evaluate=${x.evaluate}`).join("\n"));
}
console.log("\n===== navExtra"); for (const e of o.navExtra) console.log(JSON.stringify(e));
console.log("\n===== LATENCY (toggle)");
for (const l of o.latency) for (const which of ["unmount", "mount"]) {
  const t = l[which].t; const w = l[which].window;
  console.log(`rep ${l.rep} ${which}: performed ${t.performed.toFixed(1)} settled ${t.settled.toFixed(1)}; batches ${w.length}`);
  for (const m of w) console.log(`   batch events=${m.events.length} [${m.events.map((e) => `${e[1]}x${e[2]}@${(e[0] - t.t0Epoch).toFixed(1)}`).join(", ")}] sent@${(m.sentAt - t.t0Epoch).toFixed(1)} recv@${(m.receivedAt - t.t0Epoch).toFixed(1)} firstEvent->recv ${(m.receivedAt - m.events[0][0]).toFixed(1)} sent->recv ${(m.receivedAt - m.sentAt).toFixed(1)}`);
}
console.log("\n===== increment windows");
for (const x of o.node.increment) { const t = x.timing; console.log(`performed ${t.performed.toFixed(1)}: ` + x.window.map((m) => `[${m.events.map((e) => `${e[1]}x${e[2]}@${(e[0] - t.t0Epoch).toFixed(1)}`).join(",")}] recv@${(m.receivedAt - t.t0Epoch).toFixed(1)}`).join(" ")); }
console.log("\n===== ERRORS"); for (const [k, v] of Object.entries(o.errors)) console.log(k, v.ms.toFixed(1), JSON.stringify(v.error ?? v.r));
