import { describe, expect, it } from "vitest";
import type { StructuralNode } from "../tree/StructuralNode";
import { StructuralTree } from "../tree/StructuralTree";
import { SyntheticAriaRefFactory } from "../tree/SyntheticAriaRefFactory";
import { renderCompactStructuralNodeForest } from "./CompactStructuralTreeRenderer";
import {
  renderJsonStructuralNodeForest,
  type JsonStructuralNodeForest,
} from "./JsonStructuralTreeRenderer";
import { structuralNodeForest } from "./StructuralNodeForest";
import {
  projectStructuralNodeForest,
  type ProjectedStructuralNodeForest,
  type StructuralNodeForestSource,
} from "./StructuralProjection";
import {
  emitTreeOutput,
  renderTreeOutput,
  type Projection,
  type Renderer,
  type Serializer,
  type TreeOutput,
} from "./TreeOutput";

type Source = StructuralNodeForestSource<StructuralNode>;

// The existing functions are the first adapters of the stages they implement.
const projection: Projection<Source, ProjectedStructuralNodeForest> =
  projectStructuralNodeForest;
const compactRenderer: Renderer<ProjectedStructuralNodeForest, string> =
  renderCompactStructuralNodeForest;
const jsonRenderer: Renderer<
  ProjectedStructuralNodeForest,
  JsonStructuralNodeForest
> = renderJsonStructuralNodeForest;
const asIs: Serializer<string> = (rendered) => rendered;
const asJson: Serializer<JsonStructuralNodeForest> = (rendered) =>
  JSON.stringify(rendered);

const compactOutput: TreeOutput<Source, ProjectedStructuralNodeForest, string> =
  { projection, renderer: compactRenderer, serializer: asIs };
const jsonOutput: TreeOutput<
  Source,
  ProjectedStructuralNodeForest,
  JsonStructuralNodeForest
> = { projection, renderer: jsonRenderer, serializer: asJson };

const forest = structuralNodeForest(
  StructuralTree.fromAriaSnapshotYaml(
    '- main [ref=e1]:\n  - button "Save" [ref=e2]',
    new SyntheticAriaRefFactory()
  ).getRootNodes()
);

describe("emitTreeOutput", () => {
  it("applies projection, renderer and serializer in order", () => {
    expect(emitTreeOutput(compactOutput, forest)).toBe(
      '- [ref=e1] main:\n  - [ref=e2] button "Save"'
    );
    expect(JSON.parse(emitTreeOutput(jsonOutput, forest))).toEqual([
      {
        ref: "e1",
        role: "main",
        name: "",
        children: [{ ref: "e2", role: "button", name: "Save", children: [] }],
      },
    ]);
  });

  it("renders without serializing, for a shape that travels inside a larger document", () => {
    expect(renderTreeOutput(jsonOutput, forest)).toEqual([
      {
        ref: "e1",
        role: "main",
        name: "",
        children: [{ ref: "e2", role: "button", name: "Save", children: [] }],
      },
    ]);
    expect(renderTreeOutput(compactOutput, forest)).toBe(
      emitTreeOutput(compactOutput, forest)
    );
  });

  it("takes an operated forest as its source unchanged", () => {
    const exploded = forest.explode((_entry, node) => node.role === "main");

    expect(emitTreeOutput(compactOutput, exploded)).toBe(
      '- [ref=e2] button "Save"'
    );
  });

  it("composes a projection with options as a closure", () => {
    const withoutIdentity: Projection<Source, ProjectedStructuralNodeForest> = (
      source
    ) => projectStructuralNodeForest(source, { includeIdentity: false });

    expect(
      emitTreeOutput({ ...compactOutput, projection: withoutIdentity }, forest)
    ).toBe('- main:\n  - button "Save"');
  });
});
