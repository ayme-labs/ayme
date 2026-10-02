import {
  AriaRefSchema,
  StructuralNode,
  StructuralTree,
  SyntheticAriaRefFactory,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";

/** WebMCP retains captured refs and promotes the children of ref-less wrappers. */
export function parseCapturedTree(
  yaml: string,
  refFactory: SyntheticAriaRefFactory,
  excludedRefs: ReadonlySet<AriaRef> = new Set()
): StructuralTree {
  const temporaryRefs = new Set<AriaRef>();
  let counter = 0;
  const parsed = StructuralTree.fromAriaSnapshotYaml(yaml, {
    create() {
      let ref: AriaRef;
      do {
        ref = AriaRefSchema.parse(`s_webmcp_parse_${++counter}`);
      } while (yaml.includes(`[ref=${ref}]`));
      temporaryRefs.add(ref);
      return ref;
    },
  });
  const select = (
    node: StructuralNode,
    excludedParent = false
  ): (StructuralNode | string)[] => {
    const temporary = temporaryRefs.has(node.ref);
    const excluded =
      excludedRefs.has(node.ref) || (temporary && excludedParent);
    const children = node.children.flatMap((child) =>
      typeof child === "string"
        ? excluded
          ? []
          : [child]
        : select(child, excluded)
    );
    // A present child can escape its absent wrapper, for example a top-layer dialog.
    return temporary || excluded ? children : [node.copy({ children })];
  };
  const roots =
    parsed.root.role === "fragment" && parsed.root.ref === "s_root"
      ? parsed.root.children.flatMap((child) =>
          typeof child === "string" ? [child] : select(child)
        )
      : select(parsed.root);
  const onlyRoot = roots[0];
  return new StructuralTree(
    roots.length === 1 && typeof onlyRoot !== "string" && onlyRoot !== undefined
      ? onlyRoot
      : new StructuralNode({
          ref: AriaRefSchema.parse("s_root"),
          role: "fragment",
          name: "",
          cursorPointer: false,
          children: roots,
        }),
    refFactory
  );
}
