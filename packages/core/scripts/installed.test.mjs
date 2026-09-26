import assert from "node:assert/strict";
import { test } from "node:test";

test("installed compiled exports share structural behavior and testing helpers", async () => {
  const core = await import("@ayme-dev/core/structural-observation");
  const testing = await import("@ayme-dev/core/structural-observation/testing");
  const tree = testing.StructuralTreeMockFactory.createTree();
  assert.ok(tree instanceof core.StructuralTree);
  assert.equal(tree.getAllNodes()[0].name, "Test");
  const source = new testing.MockLiveAriaSnapshotSource();
  source.setMockYaml('- button "Save" [ref=e1]');
  assert.equal(
    (await source.captureAriaSnapshot(core.PageIdSchema.parse("page")))
      .distilledYaml,
    '- button "Save" [ref=e1]'
  );
});

test("installed capture retains raw descendants and supports projection and history", async () => {
  const core = await import("@ayme-dev/core/structural-observation");
  const { MockLiveAriaSnapshotSource } =
    await import("@ayme-dev/core/structural-observation/testing");
  const source = new MockLiveAriaSnapshotSource();
  source.setMockYaml('- img "Icon" [ref=e1]:\n  - generic "Path" [ref=e2]');
  const pageId = core.PageIdSchema.parse("page");
  const service = new core.StructuralTreeCaptureService({
    snapshotSource: source,
    clock: { now: () => core.MonotonicTimeMsSchema.parse(1) },
    refFactory: new core.SyntheticAriaRefFactory(),
  });
  const capture = await service.capture(pageId);
  const evidence = capture.asEvidence();
  const tree = await evidence.resolve();
  assert.equal(await evidence.resolve(), tree);
  assert.deepEqual(tree.getAllRefs(), ["e1", "e2"]);
  const forest = core.projectStructuralNodeForest({
    roots: tree.getRootNodes(),
    children: (node) => node.children,
    structuralNode: (node) => node,
  });
  assert.match(core.renderCompactStructuralNodeForest(forest), /Path/);
  const after = core.StructuralTree.fromAriaSnapshotYaml(
    '- img "Icon" [ref=e1]:\n  - generic "Changed path" [ref=e2]',
    new core.SyntheticAriaRefFactory()
  );
  const change = core.StructuralTree.reconcile(tree, after);
  assert.equal(
    change.getBeforeNodeForAfterRef(core.AriaRefSchema.parse("e2")).name,
    "Path"
  );
  assert.equal(
    change.getNode(core.AriaRefSchema.parse("e2")).status.kind,
    "updated"
  );
  const session = new core.StructuralObservationSession({
    clock: { now: () => 1 },
  });
  const registration = session.recordNavigation({
    pageId,
    url: "https://example.test",
    cause: "initial",
  });
  assert.equal(registration.kind, "visit-started");
  assert.equal(session.currentVisitIdForPage(pageId), registration.visit.id);
});
