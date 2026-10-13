import {
  isSyntheticRef,
  parseStructuralRef,
  refWrittenOtherwise,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import { resolvePageStateRefs, type AymeNode } from "./pageState";
import { RefResolutionError, ToolInputError } from "./errors";

/**
 * Package-internal: the hint toward the ref `requested` names when it writes
 * a Structural Ref another way, if it does.
 */
export function refHint(requested: string): string | undefined {
  const ref = refWrittenOtherwise(requested);
  return ref && `Pass the Structural Ref alone: ${ref}.`;
}

/**
 * Package-internal: the node a tool's Structural Ref addresses now, the one
 * resolver every tool's `ref` goes through. A synthetic ref, which names an
 * observation-only node, resolves only when `synthetic` is `"allow"`: a
 * collection tool's Page Object Root may have one. A value that is not a
 * Structural Ref, a ref that names nothing now, or a refused synthetic one
 * fails as `Cannot ${label} ref "e1": …`; the first as input, naming the ref
 * to pass when it writes one another way.
 */
export async function resolveRef(
  requested: string,
  { synthetic }: { synthetic: "allow" | "refuse" },
  label: string,
  currentDocument: Document
): Promise<AymeNode> {
  const failure = (reason: string) =>
    `Cannot ${label} ref "${requested}": ${reason}.`;
  const fail = (reason: string) => new RefResolutionError(failure(reason));
  const requestedRef = parseStructuralRef(requested);
  if (requestedRef === undefined)
    throw new ToolInputError(
      `${failure("not a Structural Ref")} ${
        refHint(requested) ?? "Pass a ref from snapshot, such as e5."
      }`
    );
  const refused = (ref: AriaRef) =>
    synthetic === "refuse" && isSyntheticRef(ref);

  if (refused(requestedRef)) throw fail("synthetic observation-only ref");

  const resolution = (
    await resolvePageStateRefs(currentDocument, requestedRef)
  )[0]!;
  if (resolution.status === "unresolved") throw fail(resolution.reason);
  if (refused(resolution.node.ref))
    throw fail("synthetic observation-only ref");
  return resolution.node;
}
