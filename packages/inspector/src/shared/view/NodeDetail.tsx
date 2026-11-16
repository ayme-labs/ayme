import { nodeText, type DescribedNode } from "../domain/nodeDescription";

/** An element's role and accessible name, or its direct text when unnamed. */
export function NodeDetail({ node }: { node: DescribedNode }) {
  const text = nodeText(node);
  return (
    <>
      {` ${node.role}`}
      {text && (
        <span
          className={
            node.name
              ? "text-green-700 dark:text-green-300"
              : "text-muted-foreground"
          }
        >
          {` ${text}`}
        </span>
      )}
    </>
  );
}
