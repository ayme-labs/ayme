import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MonotonicTimeMsSchema } from "./MonotonicTimeMs";
import { defineStructuralEnrichment } from "../tree/StructuralEnrichment";
import { AriaRefSchema } from "../tree/StructuralTypes";
import { SyntheticAriaRefFactory } from "../tree/SyntheticAriaRefFactory";
import { PageIdSchema } from "./PageId";
import { defineStructuralEnrichmentEvidence } from "./StructuralTreeEvidence";
import { StructuralTree } from "../tree/StructuralTree";
import { StructuralTreeCaptureService } from "./StructuralTreeCaptureService";
import type { LiveAriaSnapshotSource } from "./LiveAriaSnapshot";

const componentEnrichment = defineStructuralEnrichment({
  key: "component",
  schema: z.object({ name: z.string() }),
  properties: { name: (value) => value.name },
  hasChanged: (before, after) => before?.name !== after?.name,
});

const htmlEnrichment = defineStructuralEnrichment({
  key: "html",
  schema: z.object({ html: z.string() }),
  properties: { html: (value) => value.html },
  hasChanged: (before, after) => before?.html !== after?.html,
});

const svgEnrichment = defineStructuralEnrichment({
  key: "svg",
  schema: z.object({ markup: z.string() }),
  properties: { markup: (value) => value.markup },
  hasChanged: (before, after) => before?.markup !== after?.markup,
});

function source(snapshot: {
  distilledYaml: string;
  undistilledYaml: string;
}): LiveAriaSnapshotSource {
  return { captureAriaSnapshot: vi.fn(async () => snapshot) };
}

describe("StructuralTreeCaptureService", () => {
  it("captures one paired snapshot for the requested page and stamps the sample time", async () => {
    const pageId = PageIdSchema.parse("page@one");
    const snapshotSource = source({
      distilledYaml: '- button "Visible" [ref=e1]',
      undistilledYaml: '- button "Visible" [ref=e1]\n- generic "Raw" [ref=e2]',
    });
    const service = new StructuralTreeCaptureService({
      snapshotSource,
      clock: { now: () => MonotonicTimeMsSchema.parse(42) },
      refFactory: new SyntheticAriaRefFactory(),
    });

    const capture = await service.capture(pageId);

    expect(snapshotSource.captureAriaSnapshot).toHaveBeenCalledWith(pageId);
    expect(capture.pageId).toBe(pageId);
    expect(capture.capturedAt).toBe(42);
    expect(
      (await capture.asEvidence().resolve()).getNode(AriaRefSchema.parse("e2"))
    ).toBeNull();
    expect(
      (await capture.resolveUndistilledTree()).getNode(
        AriaRefSchema.parse("e2")
      )
    ).not.toBeNull();
  });

  it("resolves typed enrichment lazily and memoizes the resolved tree", async () => {
    const resolve = vi.fn(
      async () => new Map([[AriaRefSchema.parse("e1"), { name: "SaveButton" }]])
    );
    const service = new StructuralTreeCaptureService({
      snapshotSource: source({
        distilledYaml: '- button "Save" [ref=e1]',
        undistilledYaml: '- button "Save" [ref=e1]',
      }),
      clock: { now: () => MonotonicTimeMsSchema.parse(1) },
      refFactory: new SyntheticAriaRefFactory(),
    });
    const capture = await service.capture(PageIdSchema.parse("page@one"));
    const evidence = capture.asEvidence([
      defineStructuralEnrichmentEvidence(componentEnrichment, resolve),
    ]);

    expect(resolve).not.toHaveBeenCalled();
    const first = evidence.resolve();
    const second = evidence.resolve();

    expect(first).toBe(second);
    const tree = await first;
    expect(resolve).toHaveBeenCalledOnce();
    expect(
      tree
        .getNode(AriaRefSchema.parse("e1"))
        ?.enrichmentValue(componentEnrichment)
    ).toEqual({
      name: "SaveButton",
    });
  });

  it("preserves structural properties and inline text when attaching enrichment", async () => {
    const resolve = vi.fn(
      async () => new Map([[AriaRefSchema.parse("e1"), { name: "DocsLink" }]])
    );
    const service = new StructuralTreeCaptureService({
      snapshotSource: source({
        distilledYaml:
          '- link "Docs" [ref=e1]:\n  - /url: https://example.test/docs\n  - text: Open documentation',
        undistilledYaml: '- link "Docs" [ref=e1]',
      }),
      clock: { now: () => MonotonicTimeMsSchema.parse(1) },
      refFactory: new SyntheticAriaRefFactory(),
    });

    const capture = await service.capture(PageIdSchema.parse("page@one"));
    const tree = await capture
      .asEvidence([
        defineStructuralEnrichmentEvidence(componentEnrichment, resolve),
      ])
      .resolve();
    const link = tree.getNode(AriaRefSchema.parse("e1"));

    expect(link?.props).toEqual({ url: "https://example.test/docs" });
    expect(link?.children).toEqual(["Open documentation"]);
    expect(link?.enrichmentValue(componentEnrichment)).toEqual({
      name: "DocsLink",
    });
  });

  it("fixes the enrichment evidence sequence when the evidence handle is created", async () => {
    const resolve = vi.fn(
      async () => new Map([[AriaRefSchema.parse("e1"), { name: "SaveButton" }]])
    );
    const service = new StructuralTreeCaptureService({
      snapshotSource: source({
        distilledYaml: '- button "Save" [ref=e1]',
        undistilledYaml: '- button "Save" [ref=e1]',
      }),
      clock: { now: () => MonotonicTimeMsSchema.parse(1) },
      refFactory: new SyntheticAriaRefFactory(),
    });
    const capture = await service.capture(PageIdSchema.parse("page@one"));
    const enrichment = [
      defineStructuralEnrichmentEvidence(componentEnrichment, resolve),
    ];

    const evidence = capture.asEvidence(enrichment);
    enrichment.length = 0;

    const tree = await evidence.resolve();
    expect(resolve).toHaveBeenCalledOnce();
    expect(
      tree
        .getNode(AriaRefSchema.parse("e1"))
        ?.enrichmentValue(componentEnrichment)
    ).toEqual({
      name: "SaveButton",
    });
  });

  it("retains SVG descendants with and without enrichment for reconciliation", async () => {
    const svgMarkup = '<svg viewBox="0 0 14 14"></svg>';
    const service = new StructuralTreeCaptureService({
      snapshotSource: source({
        distilledYaml:
          '- button "Search" [ref=e1]:\n  - img [ref=e2]:\n    - generic "Path" [ref=e3]',
        undistilledYaml:
          '- button "Search" [ref=e1]:\n  - img [ref=e2]:\n    - generic "Path" [ref=e3]',
      }),
      clock: { now: () => MonotonicTimeMsSchema.parse(1) },
      refFactory: new SyntheticAriaRefFactory(),
    });
    const capture = await service.capture(PageIdSchema.parse("page@one"));
    const enriched = await capture
      .asEvidence([
        defineStructuralEnrichmentEvidence(
          svgEnrichment,
          async () =>
            new Map([[AriaRefSchema.parse("e2"), { markup: svgMarkup }]])
        ),
      ])
      .resolve();
    const uncollapsed = await capture
      .asEvidence([
        defineStructuralEnrichmentEvidence(
          htmlEnrichment,
          async () =>
            new Map([[AriaRefSchema.parse("e2"), { html: svgMarkup }]])
        ),
      ])
      .resolve();

    expect(
      enriched
        .getNode(AriaRefSchema.parse("e2"))
        ?.enrichmentValue(svgEnrichment)
    ).toEqual({
      markup: svgMarkup,
    });
    expect(enriched.getNode(AriaRefSchema.parse("e3"))).not.toBeNull();
    const raw = await capture.asEvidence().resolve();
    expect(raw.getAllRefs()).toEqual(["e1", "e2", "e3"]);
    expect(
      raw.getNode(AriaRefSchema.parse("e2"))?.enrichmentValue(svgEnrichment)
    ).toBeUndefined();
    const reconciled = StructuralTree.reconcile(raw, enriched);
    expect(reconciled.getAllRefs()).toEqual(["e1", "e2", "e3"]);
    expect(
      uncollapsed
        .getNode(AriaRefSchema.parse("e2"))
        ?.enrichmentValue(htmlEnrichment)
    ).toEqual({
      html: svgMarkup,
    });
    expect(uncollapsed.getNode(AriaRefSchema.parse("e3"))).not.toBeNull();
  });

  it("memoizes configured enrichment failure", async () => {
    const failure = new Error("component capture failed");
    const resolve = vi.fn(async () => {
      throw failure;
    });
    const service = new StructuralTreeCaptureService({
      snapshotSource: source({
        distilledYaml: '- button "Save" [ref=e1]',
        undistilledYaml: '- button "Save" [ref=e1]',
      }),
      clock: { now: () => MonotonicTimeMsSchema.parse(1) },
      refFactory: new SyntheticAriaRefFactory(),
    });
    const capture = await service.capture(PageIdSchema.parse("page@one"));
    const evidence = capture.asEvidence([
      defineStructuralEnrichmentEvidence(componentEnrichment, resolve),
    ]);

    const first = evidence.resolve();
    const second = evidence.resolve();

    expect(first).toBe(second);
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("shares synthetic ref allocation across captures", async () => {
    const snapshotSource = source({
      distilledYaml: "- generic",
      undistilledYaml: "- generic",
    });
    const service = new StructuralTreeCaptureService({
      snapshotSource,
      clock: { now: () => MonotonicTimeMsSchema.parse(1) },
      refFactory: new SyntheticAriaRefFactory(),
    });

    const first = await service.capture(PageIdSchema.parse("page@one"));
    const second = await service.capture(PageIdSchema.parse("page@one"));

    expect((await first.asEvidence().resolve()).root.ref).toBe("s_1");
    expect((await second.asEvidence().resolve()).root.ref).toBe("s_2");
  });

  it("keeps stable distilled and undistilled allocation across evidence handles and captures", async () => {
    const snapshotSource = source({
      distilledYaml: '- generic "Distilled"',
      undistilledYaml: '- generic "Raw wrapper"\n  - generic "Distilled"',
    });
    const service = new StructuralTreeCaptureService({
      snapshotSource,
      clock: { now: () => MonotonicTimeMsSchema.parse(1) },
      refFactory: new SyntheticAriaRefFactory(),
    });

    const first = await service.capture(PageIdSchema.parse("page@one"));
    const firstRawTree = first.resolveUndistilledTree();
    const secondRawTree = first.resolveUndistilledTree();
    const firstEvidenceTree = await first.asEvidence().resolve();
    const secondEvidenceTree = await first.asEvidence().resolve();
    const nextCapture = await service.capture(PageIdSchema.parse("page@one"));
    const nextRawTree = await nextCapture.resolveUndistilledTree();

    expect(firstRawTree).toBe(secondRawTree);
    expect(firstEvidenceTree.root.ref).toBe("s_1");
    expect(secondEvidenceTree.root.ref).toBe("s_1");
    expect((await nextCapture.asEvidence().resolve()).root.ref).toBe("s_2");
    expect(nextRawTree.root.ref).not.toBe((await firstRawTree).root.ref);
  });
});

it("resolves and reconciles SVG-containing captures without an enrichment source", async () => {
  const snapshot = (name: string) => ({
    distilledYaml: `- img [ref=e1]:\n  - generic "${name}" [ref=e2]`,
    undistilledYaml: `- img [ref=e1]:\n  - generic "${name}" [ref=e2]`,
  });
  const service = new StructuralTreeCaptureService({
    snapshotSource: {
      captureAriaSnapshot: vi
        .fn()
        .mockResolvedValueOnce(snapshot("Old path"))
        .mockResolvedValueOnce(snapshot("New path")),
    },
    clock: { now: () => MonotonicTimeMsSchema.parse(1) },
    refFactory: new SyntheticAriaRefFactory(),
  });
  const before = (
    await service.capture(PageIdSchema.parse("page@one"))
  ).asEvidence();
  const after = (
    await service.capture(PageIdSchema.parse("page@one"))
  ).asEvidence();
  const pending = before.resolve();
  expect(before.resolve()).toBe(pending);
  const changeTree = StructuralTree.reconcile(
    await pending,
    await after.resolve()
  );
  expect(changeTree.getAllRefs()).toEqual(["e1", "e2"]);
  expect(changeTree.getNode(AriaRefSchema.parse("e2"))?.status?.kind).toBe(
    "updated"
  );
  expect(changeTree.getBeforeNode(AriaRefSchema.parse("e2"))?.name).toBe(
    "Old path"
  );
});
