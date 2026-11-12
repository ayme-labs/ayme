// Writes a recording as the released Recording Package: YAML-style text
// (`package.yaml`) next to a stock `trace.zip`, stored the way the released
// recorder stores a structural recording:
//
//   <root>/.ayme/recordings/<recordingId>/package.yaml
//   <root>/.ayme/recordings/<recordingId>/trace.zip
//   <root>/.ayme/recordings/latest.yaml
//
// The format was read off the released recorder (v0.1.2): the text layout from
// its structural package renderer, the header and paths from its recording
// store. Nothing of it is copied here; `check-package.mjs` runs the released
// code itself over the same recording to show the two agree.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PW_ROOT } from "./pw.mjs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  StructuralNodeForest,
  structuralNodeForest,
  projectStructuralNodeForest,
  renderCompactStructuralNodeForest,
} from "../../../packages/core/dist/index.mjs";

const require = createRequire(import.meta.url);
// The released renderer writes its fields with `yaml` 2.9.0; the workspace has
// the same version in its store, though no package the prototype may depend on.
const YAML_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml"
);
const { stringify } = require(YAML_DIR);

const fields = (value) =>
  stringify(value, { indent: 2, lineWidth: 0, defaultStringType: "PLAIN" })
    .trimEnd()
    .split("\n");
const list = (key, items) =>
  items.length === 0
    ? [`${key}: []`]
    : [
        `${key}:`,
        ...items.flatMap((item) =>
          item.map((line, i) => (i === 0 ? "  - " : "    ") + line)
        ),
      ];
const tree = (key, text) =>
  text === ""
    ? [`${key}: []`]
    : [`${key}:`, ...text.split("\n").map((line) => "  " + line)];

const ownChange = (node) =>
  node.status?.kind === "added" ||
  node.status?.kind === "removed" ||
  (node.status?.kind === "updated" && node.status.selfChanged);
const isNode = (child) => typeof child !== "string";

/** Every node, no status marks, no `/url`-style properties. */
function baselineText(structuralTree) {
  return renderCompactStructuralNodeForest(
    projectStructuralNodeForest(
      structuralNodeForest(structuralTree.getRootNodes()),
      { includeStatus: false, structuralProperties: [] }
    )
  );
}

/** Only the paths down to nodes that were added, removed or changed themselves. */
function changeText(reconciled) {
  const seen = new WeakMap();
  const onPath = (node) => {
    if (!seen.has(node))
      seen.set(
        node,
        ownChange(node) ||
          node.children.some((child) => isNode(child) && onPath(child))
      );
    return seen.get(node);
  };
  const forest = new StructuralNodeForest({
    roots: reconciled.getRootNodes(),
    // a node that only leads to a change keeps no text of its own
    children: (node) =>
      ownChange(node) ? node.children : node.children.filter(isNode),
    structuralNode: (node) => node,
    withChildren: (node, children) => node.copy({ children: [...children] }),
  }).filter(onPath);
  return renderCompactStructuralNodeForest(
    projectStructuralNodeForest(forest, { structuralProperties: [] })
  );
}

function entryLines(entry) {
  const head =
    entry.kind === "interaction"
      ? {
          kind: entry.kind,
          timestamp: entry.timestamp,
          interaction: entry.interaction,
        }
      : { kind: entry.kind, timestamp: entry.timestamp };
  const change = changeText(entry.changeTree);
  return [
    ...fields(head),
    ...(change === "" ? [] : tree("changeTree", change)),
  ];
}

export function renderPackageText(model, header, traceActionPoints) {
  const lines = [
    ...fields({
      recordingId: header.recordingId,
      mode: model.mode,
      createdAt: header.createdAt,
      url: header.url,
      tracePath: header.tracePath,
    }),
    ...list(
      "visits",
      model.visits.map((visit) => [
        ...fields({
          visitId: visit.visitId,
          url: visit.url,
          cause: visit.cause,
        }),
        ...tree("baselineTree", baselineText(visit.baselineTree)),
        ...list("timelineEntries", visit.timelineEntries.map(entryLines)),
      ])
    ),
    ...list("traceActionPoints", traceActionPoints.map(fields)),
  ];
  return lines.join("\n") + "\n";
}

// --- the JSON document the released recorder validates before it stores ------
const nodeDoc = (node) => {
  const children = node.children.map((c) => (isNode(c) ? nodeDoc(c) : c));
  return {
    ref: node.ref,
    role: node.role,
    name: node.name || undefined,
    status: node.status?.kind,
    ...(children.length > 0 ? { children } : {}),
  };
};
const treeDoc = (structuralTree) => ({
  children: structuralTree.getRootNodes().map(nodeDoc),
});

export function packageDocument(model, header, traceActionPoints) {
  return {
    mode: model.mode,
    visits: model.visits.map((visit) => ({
      visitId: visit.visitId,
      url: visit.url,
      cause: visit.cause,
      baselineTree: treeDoc(visit.baselineTree),
      timelineEntries: visit.timelineEntries.map((entry) => ({
        analysisItemId: entry.analysisItemId,
        timestamp: entry.timestamp,
        changeTree: treeDoc(entry.changeTree),
        kind: entry.kind,
        ...(entry.kind === "interaction"
          ? { interaction: entry.interaction }
          : {}),
      })),
    })),
    traceActionPoints,
    recordingId: header.recordingId,
    createdAt: header.createdAt,
    url: header.url,
    tracePath: header.tracePath,
  };
}

// --- the stock trace ---------------------------------------------------------
/** The events of a stock trace archive (`trace.trace`, JSON lines). */
export function readTraceEvents(zipFile) {
  const names = execFileSync("unzip", ["-Z1", zipFile], { encoding: "utf8" })
    .split("\n")
    .filter((name) => name.endsWith(".trace"));
  const events = [];
  for (const name of names)
    for (const line of execFileSync("unzip", ["-p", zipFile, name], {
      encoding: "utf8",
      maxBuffer: 1 << 30,
    }).split("\n"))
      if (line.trim()) events.push({ file: name, ...JSON.parse(line) });
  return events;
}

/** Store stock CLI action positions in the released string snapshot-id fields. */
export function traceActionPointsFrom(zipFile, tracePoints, version) {
  // Ask this version's stock CLI for its positions. Its action filtering and
  // tree ordering are private and differ from raw archive event order.
  const minor = version.split(".").slice(0, 2).join(".");
  const install = process.env.AYME_PW_DIR
    ? path.resolve(process.env.AYME_PW_DIR, "../..")
    : path.join(PW_ROOT, `pw-${minor}`);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ayme-trace-positions-"));
  const cli = (...args) => execFileSync("npx", ["--prefix", install, "--no-install", "playwright", "trace", ...args], { cwd, encoding: "utf8", maxBuffer: 1 << 26 });
  let actionList;
  try {
    cli("open", path.resolve(zipFile));
    actionList = cli("actions");
  } finally {
    try { cli("close"); } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }
  const positions = new Map();
  const rows = actionList.split("\n");
  for (let i = 0; i < rows.length; i++) {
    const group = /^\s*\d+\. .*?(snapshot_\d+)\s+/.exec(rows[i]);
    if (group) {
      const child = /^\s*(\d+)\. .*?Evaluate\s+/.exec(rows[i + 1] ?? "");
      if (!child) throw new Error(`No marker call immediately inside ${group[1]}`);
      positions.set(group[1], child[1]);
    }
  }
  const events = readTraceEvents(zipFile);
  const before = events.filter((e) => e.type === "before");
  const snapshots = new Set();
  for (const e of events)
    if (e.type === "frame-snapshot") {
      const s = e.snapshot;
      // 1.62 names a snapshot; later versions give it the call and a phase
      snapshots.add(s.snapshotName ?? `${s.phase}@${s.callId}`);
    }
  const groups = before.filter((e) => e.method === "tracingGroup");
  const points = [];
  const lookup = {};
  for (const point of tracePoints) {
    const out = { interactionId: point.interactionId, pageId: point.pageId };
    const details = {};
    for (const phase of ["before", "after"]) {
      const groupName = point[`${phase}Group`];
      const group = groupName && groups.findLast((g) => (g.title ?? g.params?.name) === groupName);
      const call = group && before.find((e) => e.parentId === group.callId && e.method === "evaluateExpression");
      // Markers are no-op calls: both DOM phases show the marked state. Always
      // open their after phase, even when this is the interaction's before.
      if (call && snapshots.has(`after@${call.callId}`)) {
        if (!positions.has(groupName)) throw new Error(`Stock CLI did not list ${groupName}`);
        out[`${phase}SnapshotId`] = positions.get(groupName);
        details[phase] = { callId: call.callId, position: positions.get(groupName), phase: "after" };
      }
    }
    lookup[point.interactionId] = { ...details, beforeSource: point.beforeSource };
    out.startedAt = point.startedAt;
    out.endedAt = point.endedAt;
    points.push(out);
  }
  return {
    points,
    lookup,
    stats: {
      events: events.length,
      actions: before.length,
      frameSnapshots: events.filter((e) => e.type === "frame-snapshot").length,
      version: events.find((e) => e.type === "context-options")?.version,
    },
  };
}

// --- storing -----------------------------------------------------------------
export function savePackage({ root, result, now = new Date() }) {
  const model = result.model;
  if (!model || model.visits.length === 0) return null;
  const createdAt = now.toISOString();
  const recordingId = `rec_${createdAt.replace(/[-:.]/g, "")}`;
  const recordingsDir = path.resolve(root, ".ayme", "recordings");
  const dir = path.join(recordingsDir, recordingId);
  fs.mkdirSync(dir, { recursive: true });

  let tracePath = null;
  let trace = { points: [], lookup: {}, stats: null };
  if (result.traceFile && fs.existsSync(result.traceFile)) {
    fs.copyFileSync(result.traceFile, path.join(dir, "trace.zip"));
    tracePath = path.posix.join(
      ".ayme",
      "recordings",
      recordingId,
      "trace.zip"
    );
    trace = traceActionPointsFrom(
      path.join(dir, "trace.zip"),
      model.tracePoints,
      result.meta.playwright
    );
  }
  const header = {
    recordingId,
    createdAt,
    url: model.visits[0].url,
    tracePath,
  };
  const text = renderPackageText(model, header, trace.points);
  const packagePath = path.join(dir, "package.yaml");
  fs.writeFileSync(packagePath, text);
  fs.writeFileSync(path.join(recordingsDir, "latest.yaml"), text);
  fs.rmSync(path.join(recordingsDir, "latest.json"), { force: true });
  return {
    recordingId,
    header,
    packagePath,
    dir,
    text,
    document: packageDocument(model, header, trace.points),
    traceActionPoints: trace.points,
    traceLookup: trace.lookup,
    traceStats: trace.stats,
  };
}
