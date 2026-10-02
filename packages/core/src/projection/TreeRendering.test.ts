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
  renderTree,
  type Projection,
  type Renderer,
  type TreeRendering,
} from "./TreeRendering";

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

const compactRendering: TreeRendering<
  Source,
  ProjectedStructuralNodeForest,
  string
> = { projection, renderer: compactRenderer };
const jsonRendering: TreeRendering<
  Source,
  ProjectedStructuralNodeForest,
  JsonStructuralNodeForest
> = { projection, renderer: jsonRenderer };

const forest = structuralNodeForest(
  StructuralTree.fromAriaSnapshotYaml(
    '- main [ref=e1]:\n  - button "Save" [ref=e2]',
    new SyntheticAriaRefFactory()
  ).getRootNodes()
);

describe("renderTree", () => {
  it("applies projection and renderer in order", () => {
    expect(renderTree(compactRendering, forest)).toBe(
      '- [ref=e1] main:\n  - [ref=e2] button "Save"'
    );
    expect(renderTree(jsonRendering, forest)).toEqual([
      {
        ref: "e1",
        role: "main",
        name: "",
        children: [{ ref: "e2", role: "button", name: "Save", children: [] }],
      },
    ]);
  });

  it("takes an operated forest as its source unchanged", () => {
    const exploded = forest.explode((_entry, node) => node.role === "main");

    expect(renderTree(compactRendering, exploded)).toBe(
      '- [ref=e2] button "Save"'
    );
  });

  it("composes a projection with options as a closure", () => {
    const withoutIdentity: Projection<Source, ProjectedStructuralNodeForest> = (
      source
    ) => projectStructuralNodeForest(source, { includeIdentity: false });

    expect(
      renderTree({ ...compactRendering, projection: withoutIdentity }, forest)
    ).toBe('- main:\n  - button "Save"');
  });
});
