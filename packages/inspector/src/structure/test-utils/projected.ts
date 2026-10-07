import type {
  ProjectedStructuralNode,
  ProjectedStructuralNodeForest,
} from "@ayme-dev/ayme/internal";

// Hand-written projected page state for tests: the forest the page state
// text is rendered from, as the runtime's look carries it.

type Child = ProjectedStructuralNode | string;

/** A node's own part of its line, and its Page Object labels. */
export type Header = {
  ref: string;
  role?: ProjectedStructuralNode["role"];
  name?: string;
  state?: Partial<ProjectedStructuralNode["state"]>;
  cursorPointer?: boolean;
  /** The Page Object label written on its line, e.g. "ListPage". */
  label?: string;
  /** The Page Object labels it lists as its `/pom` property. */
  pom?: readonly string[];
};

/** A projected node with its children: other nodes, or text. */
export function node(
  header: Header,
  ...children: Child[]
): ProjectedStructuralNode {
  return {
    ref: header.ref as ProjectedStructuralNode["ref"],
    identityToken: undefined,
    status: undefined,
    prefixes: [header.ref, ...(header.label ? [header.label] : [])],
    role: header.role ?? "generic",
    name: header.name ?? "",
    state: { ...header.state },
    cursorPointer: header.cursorPointer ?? false,
    properties: header.pom
      ? [{ key: "pom", label: "pom", value: header.pom }]
      : [],
    children,
    compact: false,
  };
}

/** A projected page state of these roots. */
export function forest(...roots: Child[]): ProjectedStructuralNodeForest {
  return { roots };
}
