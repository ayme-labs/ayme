import { z } from "zod";
import { describe, expect, it } from "vitest";
import { defineStructuralEnrichment } from "./StructuralEnrichment";
import { StructuralTree } from "./StructuralTree";
import { SyntheticAriaRefFactory } from "./SyntheticAriaRefFactory";

const component = defineStructuralEnrichment({
  key: "component",
  schema: z.object({ name: z.string(), tags: z.array(z.string()) }),
  properties: { name: (value) => value.name, tags: (value) => value.tags },
  hasChanged: (before, after) =>
    JSON.stringify(before) !== JSON.stringify(after),
});

const trace = defineStructuralEnrichment({
  key: "trace",
  schema: z.object({ html: z.string() }),
  properties: { html: (value) => value.html },
  hasChanged: () => false,
});

// @ts-expect-error Property selection is constrained to the enrichment definition.
component.pick("missing");

describe("Structural enrichment", () => {
  it("keeps typed values private and exposes selected properties through their kind", () => {
    const node = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e1]',
      new SyntheticAriaRefFactory()
    ).root.attachEnrichment(component, { name: "SaveButton", tags: ["form"] });

    expect(node.enrichmentValue(component)).toEqual({
      name: "SaveButton",
      tags: ["form"],
    });
    expect(
      node.enrichmentProperties(component, component.pick("name").propertyKeys)
    ).toEqual([{ key: "name", value: "SaveButton" }]);
    expect(
      node.enrichmentProperties(component, component.all().propertyKeys)
    ).toEqual([
      { key: "name", value: "SaveButton" },
      { key: "tags", value: ["form"] },
    ]);
  });

  it("uses enrichment change semantics after structural matching", () => {
    const factory = new SyntheticAriaRefFactory();
    const before = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e1]',
      factory
    ).root.attachEnrichment(component, {
      name: "SaveButton",
      tags: ["form"],
    });
    const after = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e1]',
      factory
    ).root.attachEnrichment(component, {
      name: "PrimarySaveButton",
      tags: ["form"],
    });

    const reconciled = StructuralTree.reconcile(
      new StructuralTree(before, factory),
      new StructuralTree(after, factory)
    );

    expect(reconciled.root.status).toEqual({
      kind: "updated",
      selfChanged: true,
      childListChanged: false,
    });
    expect(reconciled.root.enrichmentValue(component)).toEqual({
      name: "PrimarySaveButton",
      tags: ["form"],
    });
    expect(reconciled.toCurrentTree().root.enrichmentValue(component)).toEqual({
      name: "PrimarySaveButton",
      tags: ["form"],
    });
  });

  it("passes undefined to enrichment change semantics when a value appears or disappears", () => {
    const calls: Array<readonly [unknown, unknown]> = [];
    const evidence = defineStructuralEnrichment({
      key: "evidence",
      schema: z.object({ label: z.string() }),
      properties: { label: (value) => value.label },
      hasChanged: (before, after) => {
        calls.push([before, after]);
        return before !== after;
      },
    });
    const factory = new SyntheticAriaRefFactory();
    const baseline = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e1]',
      factory
    );
    const withEvidence = new StructuralTree(
      baseline.root.attachEnrichment(evidence, { label: "SaveButton" }),
      factory
    );

    const appeared = StructuralTree.reconcile(baseline, withEvidence);
    expect(calls).toContainEqual([undefined, { label: "SaveButton" }]);
    expect(calls.every(([before]) => before === undefined)).toBe(true);
    expect(appeared.root.enrichmentValue(evidence)).toEqual({
      label: "SaveButton",
    });

    calls.length = 0;
    const disappeared = StructuralTree.reconcile(withEvidence, baseline);
    expect(calls).toContainEqual([{ label: "SaveButton" }, undefined]);
    expect(calls.every(([, after]) => after === undefined)).toBe(true);
    expect(disappeared.root.enrichmentValue(evidence)).toBeUndefined();
  });

  it("lets a kind preserve matching behavior when its values change", () => {
    const factory = new SyntheticAriaRefFactory();
    const before = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e1]',
      factory
    ).root.attachEnrichment(trace, {
      html: '<button class="before">',
    });
    const after = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e1]',
      factory
    ).root.attachEnrichment(trace, {
      html: '<button class="after">',
    });

    const reconciled = StructuralTree.reconcile(
      new StructuralTree(before, factory),
      new StructuralTree(after, factory)
    );

    expect(reconciled.root.status).toEqual({ kind: "unchanged" });
  });
});
