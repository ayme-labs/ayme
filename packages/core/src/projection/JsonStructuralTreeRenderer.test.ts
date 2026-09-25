import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineStructuralEnrichment } from "../tree/StructuralEnrichment";
import { StructuralNode } from "../tree/StructuralNode";
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

/**
 * The Goal Loop's own serializer as it was before the JSON renderer replaced
 * it: the reference for the shape the renderer keeps.
 */
function serializeTreeReference(tree: StructuralTree): unknown {
  const serializeNode = (node: {
    ref: string;
    role: string;
    name: string;
    state: Record<string, unknown>;
    cursorPointer: boolean;
    props: Record<string, string>;
    children: readonly unknown[];
  }): unknown => ({
    ref: node.ref,
    role: node.role,
    name: node.name,
    ...(Object.values(node.state).some((v) => v !== undefined)
      ? { state: node.state }
      : {}),
    ...(node.cursorPointer ? { cursorPointer: true } : {}),
    ...(Object.keys(node.props).length > 0 ? { props: node.props } : {}),
    children: node.children.map((child) =>
      typeof child === "string" ? child : serializeNode(child as typeof node)
    ),
  });
  return tree.getRootNodes().map(serializeNode);
}

/** A page as captured: landmarks, states, a pointer cursor, props and text, no adjacent strings. */
const CAPTURED_PAGE =
  "- generic [ref=e1]:\n" +
  '  - main "Playground" [ref=e2]:\n' +
  '    - heading "My list" [level=2] [ref=e3]\n' +
  "    - paragraph [ref=e4]:\n" +
  "      - text: Two tasks are open.\n" +
  '      - link "Docs" [ref=e5]:\n' +
  "        - /url: https://example.com/docs\n" +
  "        - text: Docs\n" +
  "      - text: for details.\n" +
  "    - form [ref=e6]:\n" +
  '      - textbox "New item" [ref=e7] [active]:\n' +
  "        - /placeholder: e.g. Send the update\n" +
  '      - button "Add item" [ref=e8] [cursor=pointer]\n' +
  '      - checkbox "Urgent" [checked] [ref=e9]\n' +
  '      - button "Locked" [disabled] [ref=e10]\n' +
  "    - list [ref=e11]:\n" +
  '      - listitem "Item 1" [ref=e12] [selected]:\n' +
  "        - generic [ref=e13]: Item 1\n" +
  '        - button "Archive" [ref=e14]\n' +
  '  - dialog "Archive item" [ref=e15]:\n' +
  '    - button "Cancel" [ref=e16]\n' +
  "- generic [ref=e17]: footer";

describe("renderJsonStructuralNodeForest", () => {
  it("renders the shape the Goal Loop's serializer produced before it moved here", () => {
    const tree = parse(CAPTURED_PAGE);

    const rendered = renderJson(tree);

    expect(rendered).toEqual(serializeTreeReference(tree));
    // Not a vacuous match: every kind of field is exercised at least once.
    expect(JSON.stringify(rendered)).toContain('"state":{');
    expect(JSON.stringify(rendered)).toContain('"cursorPointer":true');
    expect(JSON.stringify(rendered)).toContain('"props":{"url":');
    expect(JSON.stringify(rendered)).toContain('"children":["Docs"]');
  });

  it("keeps the shape on adjacent strings too, which stay separate", () => {
    const factory = new SyntheticAriaRefFactory();
    const root = new StructuralNode({
      ref: factory.create(),
      role: "paragraph",
      name: "",
      cursorPointer: false,
      children: ["Hel", "lo", parse('- button "Go" [ref=e2]').root, "!"],
    });
    const tree = new StructuralTree(root, factory);

    const rendered = renderJson(tree);

    expect(rendered).toEqual(serializeTreeReference(tree));
    expect(
      (rendered[0] as unknown as { children: unknown[] }).children
    ).toEqual(["Hel", "lo", expect.objectContaining({ ref: "e2" }), "!"]);
  });

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

  it("keeps adjacent text children left by an exploded node separate", () => {
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
          "a",
          "b",
          { ref: "e4", role: "button", name: "Go", children: [] },
          "c",
          "d",
        ],
      },
    ]);
  });

  it("keeps adjacent text roots separate", () => {
    const forest = structuralNodeForest(
      parse("- generic [ref=e1]: a\n- generic [ref=e2]: b").getRootNodes()
    ).explode(() => true);

    expect(
      renderJsonStructuralNodeForest(projectStructuralNodeForest(forest))
    ).toEqual(["a", "b"]);
  });
});
