import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineStructuralEnrichment } from "../tree/StructuralEnrichment";
import { StructuralTree } from "../tree/StructuralTree";
import { SyntheticAriaRefFactory } from "../tree/SyntheticAriaRefFactory";
import { renderJsonStructuralNodeForest } from "./JsonStructuralTreeRenderer";
import { structuralNodeForest } from "./StructuralNodeForest";
import { projectStructuralNodeForest } from "./StructuralProjection";

function parse(yaml: string): StructuralTree {
  return StructuralTree.fromAriaSnapshotYaml(
    yaml,
    new SyntheticAriaRefFactory()
  );
}

function renderJson(tree: StructuralTree) {
  return renderJsonStructuralNodeForest(
    projectStructuralNodeForest(structuralNodeForest(tree.getRootNodes()))
  );
}

describe("renderJsonStructuralNodeForest", () => {
  it("renders one object per node with ref, role, name and children", () => {
    expect(
      renderJson(
        parse('- generic [ref=e1]:\n  - button "Save" [ref=e2]\n  - text: note')
      )
    ).toEqual([
      {
        ref: "e1",
        role: "generic",
        name: "",
        children: [
          { ref: "e2", role: "button", name: "Save", children: [] },
          "note",
        ],
      },
    ]);
  });

  it("adds state, cursorPointer and props only when they carry something", () => {
    const [checkbox, link, plain] = renderJson(
      parse(
        '- checkbox "Ready" [checked] [ref=e1] [cursor=pointer]\n' +
          '- link "Docs" [ref=e2]:\n  - /url: https://example.com/docs\n' +
          '- button "Plain" [ref=e3]'
      )
    );

    expect(checkbox).toMatchObject({
      state: { checked: true },
      cursorPointer: true,
    });
    expect(checkbox).not.toHaveProperty("props");
    expect(link).toMatchObject({ props: { url: "https://example.com/docs" } });
    expect(link).not.toHaveProperty("state");
    expect(link).not.toHaveProperty("cursorPointer");
    expect(plain).toEqual({
      ref: "e3",
      role: "button",
      name: "Plain",
      children: [],
    });
  });

  it("keys projected properties by their key, so enrichment does not collide with a structural prop", () => {
    const component = defineStructuralEnrichment({
      key: "component",
      schema: z.object({ url: z.string() }),
      properties: { url: (value) => value.url },
      hasChanged: () => false,
    });
    const tree = parse(
      '- link "Docs" [ref=e1]:\n  - /url: https://example.com'
    );
    const root = tree.root.attachEnrichment(component, { url: "Docs.link" });

    const [link] = renderJsonStructuralNodeForest(
      projectStructuralNodeForest(structuralNodeForest([root]), {
        enrichment: [component.pick("url")],
      })
    );

    expect(link).toMatchObject({
      props: { url: "https://example.com", "component.url": "Docs.link" },
    });
  });

  it("renders only what the projection selected", () => {
    const tree = parse(
      '- generic [ref=e1]:\n  - button "Keep" [ref=e2]\n  - link "Omit" [ref=e3]:\n    - /url: https://example.com'
    );

    expect(
      renderJsonStructuralNodeForest(
        projectStructuralNodeForest(structuralNodeForest(tree.getRootNodes()), {
          includeNode: (_entry, node) => node.role !== "link",
          structuralProperties: [],
        })
      )
    ).toEqual([
      {
        ref: "e1",
        role: "generic",
        name: "",
        children: [{ ref: "e2", role: "button", name: "Keep", children: [] }],
      },
    ]);
  });

  it("joins adjacent text children left by an exploded node", () => {
    const tree = parse(
      "- paragraph [ref=e1]:\n" +
        "  - generic [ref=e2]: a\n" +
        "  - generic [ref=e3]: b\n" +
        '  - button "Go" [ref=e4]\n' +
        "  - generic [ref=e5]: c\n" +
        "  - text: d"
    );
    const forest = structuralNodeForest(tree.getRootNodes()).explode(
      (_entry, node) => node.role === "generic"
    );

    expect(
      renderJsonStructuralNodeForest(projectStructuralNodeForest(forest))
    ).toEqual([
      {
        ref: "e1",
        role: "paragraph",
        name: "",
        children: [
          "ab",
          { ref: "e4", role: "button", name: "Go", children: [] },
          "cd",
        ],
      },
    ]);
  });

  it("joins adjacent text roots", () => {
    const forest = structuralNodeForest(
      parse("- generic [ref=e1]: a\n- generic [ref=e2]: b").getRootNodes()
    ).explode(() => true);

    expect(
      renderJsonStructuralNodeForest(projectStructuralNodeForest(forest))
    ).toEqual(["ab"]);
  });
});
