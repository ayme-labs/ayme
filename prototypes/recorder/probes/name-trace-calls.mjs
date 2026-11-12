// Can the shipped skill's own command (`trace snapshot interaction_3 --name after`)
// be made to work on a stock trace? Only by rewriting the archive after stock
// tracing wrote it: the call inside each `interaction_N` group is given the
// interaction id as its call id. This is a text rewrite of `trace.trace`,
// whose shape is private to Playwright and differs between 1.62 and 1.65.
// usage: node probes/name-trace-calls.mjs <trace.zip> <out.zip>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [zip, out] = process.argv.slice(2).map((p) => path.resolve(p));
const dir = out.replace(/\.zip$/, "") + "-files";
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
execFileSync("unzip", ["-q", zip, "-d", dir]);
const file = path.join(dir, "trace.trace");
const events = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const before = events.filter((e) => e.type === "before");
const renames = new Map();
for (const group of before.filter((e) => e.method === "tracingGroup")) {
  const name = group.title ?? group.params?.name;
  if (!/^interaction_\d+$/.test(name ?? "")) continue;
  const call = before.find((e) => e.parentId === group.callId);
  // a later group of the same interaction (typing) wins
  for (const [from, to] of renames) if (to === name) renames.delete(from);
  if (call) renames.set(call.callId, name);
}
const rename = (id) => renames.get(id) ?? id;
for (const e of events) {
  if (e.callId) e.callId = rename(e.callId);
  if (e.type === "before") {
    // 1.62 names a call's snapshots in the call's own events
    for (const key of ["beforeSnapshot", "afterSnapshot", "inputSnapshot"])
      if (typeof e[key] === "string")
        e[key] = e[key].replace(/@(.+)$/, (_, id) => "@" + rename(id));
  }
  if (e.type === "after" && typeof e.afterSnapshot === "string")
    e.afterSnapshot = e.afterSnapshot.replace(
      /@(.+)$/,
      (_, id) => "@" + rename(id)
    );
  if (e.type === "input" && typeof e.inputSnapshot === "string")
    e.inputSnapshot = e.inputSnapshot.replace(
      /@(.+)$/,
      (_, id) => "@" + rename(id)
    );
  if (e.type === "frame-snapshot") {
    const s = e.snapshot;
    if (s.callId) s.callId = rename(s.callId);
    if (typeof s.snapshotName === "string")
      s.snapshotName = s.snapshotName.replace(
        /@(.+)$/,
        (_, id) => "@" + rename(id)
      );
  }
}
fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
fs.rmSync(out, { force: true });
execFileSync("zip", ["-q", "-r", out, "."], { cwd: dir });
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(Object.fromEntries(renames)));
