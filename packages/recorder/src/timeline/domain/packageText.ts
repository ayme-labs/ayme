import {
  projectStructuralNodeForest,
  renderCompactStructuralNodeForest,
  StructuralNodeForest,
  structuralNodeForest,
  type StructuralNode,
  type StructuralTree,
} from "@ayme-dev/core/structural-observation";
import { stringify } from "yaml";

import type {
  InteractionDetails,
  RecordedVisit,
  TimelineEntry,
} from "../../contract";
import type { InteractionReport } from "./recorded";

// The text of a Recording Package, in the released format: the layout the
// `ayme-recorder` skill and the 0.1 recorder's readers know. Trees are core's
// compact notation; everything else is written as YAML.

/** What a recording is filed under. */
export type PackageHeader = {
  readonly recordingId: string;
  /** ISO 8601. */
  readonly createdAt: string;
  /** Relative to the project folder; null when the recording has no trace. */
  readonly tracePath: string | null;
};

/** A Visit as the package shows it: with its starting picture. */
export type PackageVisit = RecordedVisit & { readonly baselineTree: string };

/**
 * Where the trace holds one Interaction: the numbers the stock trace tool
 * takes to open the snapshots around it, in the released fields. A position
 * is text, as the released format keeps it.
 */
export type TracePoint = {
  readonly interactionId: string;
  readonly pageId: string;
  readonly beforeSnapshotId?: string;
  /** Absent when the Interaction left its page. */
  readonly afterSnapshotId?: string;
  /** Milliseconds on the recorded browser's monotonic clock. */
  readonly startedAt: number;
  readonly endedAt: number;
};

/** What Playwright says of an Interaction, in the order the package lists it. */
const INTERACTION_VALUES = [
  "url",
  "value",
  "text",
  "button",
  "modifiers",
  "clickCount",
  "position",
  "key",
  "files",
  "options",
];

/** An Interaction as the package lists it, in the released order of fields. */
export function interactionDetails(
  id: string,
  report: InteractionReport,
  targetRef: string | null
): InteractionDetails {
  const details: Record<string, unknown> = {
    id,
    type: report.type,
    // Always there: a reader of the released format requires the field, and
    // takes null for a target that is not known.
    targetRef,
    ...(report.selector ? { targetSelector: report.selector } : {}),
  };
  for (const key of INTERACTION_VALUES)
    if (key in report.values) details[key] = report.values[key];
  return details as InteractionDetails;
}

const fields = (value: object) =>
  stringify(value, { indent: 2, lineWidth: 0, defaultStringType: "PLAIN" })
    .trimEnd()
    .split("\n");
const list = (key: string, items: readonly string[][]) =>
  items.length === 0
    ? [`${key}: []`]
    : [
        `${key}:`,
        ...items.flatMap((item) =>
          item.map((line, index) => (index === 0 ? "  - " : "    ") + line)
        ),
      ];
const tree = (key: string, text: string) =>
  text === ""
    ? [`${key}: []`]
    : [`${key}:`, ...text.split("\n").map((line) => "  " + line)];

const changedItself = (node: StructuralNode) =>
  node.status?.kind === "added" ||
  node.status?.kind === "removed" ||
  (node.status?.kind === "updated" && node.status.selfChanged);
const isNode = (child: StructuralNode | string) => typeof child !== "string";

/** Every node, with no status mark and no property such as a link's URL. */
export function wholeTreeText(structuralTree: StructuralTree): string {
  return renderCompactStructuralNodeForest(
    projectStructuralNodeForest(
      structuralNodeForest(structuralTree.getRootNodes()),
      { includeStatus: false, structuralProperties: [] }
    )
  );
}

/** A Change Tree's text: only the ways down to the nodes that were added,
 * removed or changed themselves. Empty when there is none. */
export function changeText(change: StructuralTree): string {
  const leads = new WeakMap<StructuralNode, boolean>();
  const leadsToChange = (node: StructuralNode): boolean => {
    let known = leads.get(node);
    if (known === undefined) {
      known =
        changedItself(node) ||
        node.children.some((child) => isNode(child) && leadsToChange(child));
      leads.set(node, known);
    }
    return known;
  };
  const forest = new StructuralNodeForest<StructuralNode>({
    roots: change.getRootNodes(),
    // A node that only leads to a change keeps no text of its own.
    children: (node) =>
      changedItself(node) ? node.children : node.children.filter(isNode),
    structuralNode: (node) => node,
    withChildren: (node, children) => node.copy({ children: [...children] }),
  }).filter(leadsToChange);
  return renderCompactStructuralNodeForest(
    projectStructuralNodeForest(forest, { structuralProperties: [] })
  );
}

const entryLines = (entry: TimelineEntry) =>
  entry.discarded ? stubLines(entry) : keptLines(entry);

/** What the released recorder keeps of an entry the person left out: where
 * it was, and for an Interaction its id and type. No target, no value, no
 * Change Tree. */
const stubLines = (entry: TimelineEntry) =>
  fields(
    entry.kind === "interaction"
      ? {
          kind: entry.kind,
          timestamp: entry.timestamp,
          discarded: true,
          interaction: {
            id: entry.interaction.id,
            type: entry.interaction.type,
          },
        }
      : { kind: entry.kind, timestamp: entry.timestamp, discarded: true }
  );

const keptLines = (entry: TimelineEntry) => [
  ...fields(
    entry.kind === "interaction"
      ? {
          kind: entry.kind,
          timestamp: entry.timestamp,
          interaction: entry.interaction,
        }
      : { kind: entry.kind, timestamp: entry.timestamp }
  ),
  ...(entry.changeTree === null ? [] : tree("changeTree", entry.changeTree)),
];

/** The package's text. Its `url` is the first Visit's. */
export function renderPackage(
  header: PackageHeader,
  visits: readonly PackageVisit[],
  tracePoints: readonly TracePoint[]
): string {
  const lines = [
    ...fields({
      recordingId: header.recordingId,
      mode: "structural",
      createdAt: header.createdAt,
      url: visits[0]?.url,
      tracePath: header.tracePath,
    }),
    ...list(
      "visits",
      visits.map((visit) => [
        ...fields({
          visitId: visit.visitId,
          url: visit.url,
          cause: visit.cause,
        }),
        ...tree("baselineTree", visit.baselineTree),
        ...list("timelineEntries", visit.entries.map(entryLines)),
      ])
    ),
    ...list(
      "traceActionPoints",
      tracePoints.map((point) => fields(point))
    ),
  ];
  return lines.join("\n") + "\n";
}
