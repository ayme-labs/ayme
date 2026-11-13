import {
  projectStructuralNodeForest,
  renderCompactStructuralNodeForest,
  StructuralNodeForest,
  structuralNodeForest,
  type StructuralNode,
  type StructuralTree,
} from "@ayme-dev/core/structural-observation";
import { stringify } from "yaml";

import type { InteractionReport, VisitCause } from "./recorded";

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

export type PackageEntry =
  | {
      readonly kind: "interaction";
      readonly timestamp: number;
      readonly id: string;
      readonly report: InteractionReport;
      /** Undefined when the target is not known in the tree. */
      readonly targetRef: string | undefined;
      /** Null when no "after" was taken. */
      readonly changeTree: StructuralTree | null;
    }
  | {
      readonly kind: "change";
      readonly timestamp: number;
      readonly changeTree: StructuralTree;
    };

export type PackageVisit = {
  readonly visitId: string;
  readonly url: string;
  readonly cause: VisitCause;
  readonly baselineTree: StructuralTree;
  readonly timelineEntries: readonly PackageEntry[];
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
function wholeTreeText(structuralTree: StructuralTree): string {
  return renderCompactStructuralNodeForest(
    projectStructuralNodeForest(
      structuralNodeForest(structuralTree.getRootNodes()),
      { includeStatus: false, structuralProperties: [] }
    )
  );
}

/** A Change Tree's text: only the ways down to the nodes that were added,
 * removed or changed themselves. Empty when there is none. */
function changeText(change: StructuralTree): string {
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

function entryLines(entry: PackageEntry): string[] | undefined {
  const change = entry.changeTree ? changeText(entry.changeTree) : "";
  if (entry.kind === "change")
    // Nothing changed: there is nothing to tell.
    return change === ""
      ? undefined
      : [
          ...fields({ kind: entry.kind, timestamp: entry.timestamp }),
          ...tree("changeTree", change),
        ];
  const { report } = entry;
  const interaction: Record<string, unknown> = {
    id: entry.id,
    type: report.type,
    ...(entry.targetRef ? { targetRef: entry.targetRef } : {}),
    ...(report.selector ? { targetSelector: report.selector } : {}),
  };
  for (const key of INTERACTION_VALUES)
    if (key in report.values) interaction[key] = report.values[key];
  return [
    ...fields({ kind: entry.kind, timestamp: entry.timestamp, interaction }),
    ...(change === "" ? [] : tree("changeTree", change)),
  ];
}

/** The package's text. Its `url` is the first Visit's. */
export function renderPackage(
  header: PackageHeader,
  visits: readonly PackageVisit[]
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
        ...tree("baselineTree", wholeTreeText(visit.baselineTree)),
        ...list(
          "timelineEntries",
          visit.timelineEntries.flatMap((entry) => {
            const lines = entryLines(entry);
            return lines ? [lines] : [];
          })
        ),
      ])
    ),
    // The trace's position numbers join with the trace file.
    ...list("traceActionPoints", []),
  ];
  return lines.join("\n") + "\n";
}
