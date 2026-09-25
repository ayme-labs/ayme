import {
  AriaRefSchema,
  StructuralNode,
  StructuralTree,
  SyntheticAriaRefFactory,
  StructuralTreeCaptureService,
  MonotonicTimeMsSchema,
  PageIdSchema,
  projectStructuralNodeForest,
  renderCompactStructuralNodeForest,
} from "@ayme-dev/core/structural-observation";
import {
  MockLiveAriaSnapshotSource,
  StructuralTreeMockFactory,
} from "@ayme-dev/core/structural-observation/testing";
import type { AriaNode } from "./public-aria-types.js";

export function acceptPublicPlaywrightNode(node: AriaNode): StructuralNode {
  return StructuralNode.fromAriaNode(node, AriaRefSchema.parse("s_1"));
}
const tree: StructuralTree = StructuralTreeMockFactory.createTree();
export const rendered: string = renderCompactStructuralNodeForest(
  projectStructuralNodeForest({
    roots: tree.getRootNodes(),
    children: (node) => node.children,
    structuralNode: (node) => node,
  })
);
const service = new StructuralTreeCaptureService({
  snapshotSource: new MockLiveAriaSnapshotSource(),
  clock: { now: () => MonotonicTimeMsSchema.parse(1) },
  refFactory: new SyntheticAriaRefFactory(),
});
export const capture = service.capture(PageIdSchema.parse("page"));

import type {
  PreparedNavigation,
  StructuralActionStartedEntry,
  StructuralActionCompletedEntry,
  StructuralNavigationEntry,
  StructuralVisitOpeningNavigationEntry,
} from "@ayme-dev/core/structural-observation";
import { StructuralObservationSession } from "@ayme-dev/core/structural-observation";
export function recordAction(
  session: StructuralObservationSession,
  started: StructuralActionStartedEntry,
  completed: StructuralActionCompletedEntry
) {
  session.recordActionStarted(started);
  session.recordActionCompleted(completed);
}
export function commitNavigation(
  prepared: PreparedNavigation
):
  | StructuralNavigationEntry
  | StructuralVisitOpeningNavigationEntry
  | undefined {
  const registration = prepared.commit();
  return registration.kind === "ignored" ? undefined : registration.entry;
}
