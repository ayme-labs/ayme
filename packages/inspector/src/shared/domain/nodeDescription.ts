/** The accessible identity and direct text shared by structure and ref rows. */
export type DescribedNode = {
  role: string;
  name: string;
  children: readonly (string | { role: string; name: string; ref?: string })[];
};

/** A name takes precedence over direct text, without borrowing a child's identity. */
export function nodeText(node: DescribedNode): string {
  return node.name
    ? JSON.stringify(node.name)
    : node.children
        .flatMap((child) =>
          typeof child === "string"
            ? [child]
            : child.role === "text" && child.ref === undefined
              ? [child.name]
              : []
        )
        .join(" ");
}

export function nodeLabel(node: DescribedNode): string {
  return [node.role, nodeText(node)].filter(Boolean).join(" ");
}
