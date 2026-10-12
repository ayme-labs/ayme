import {
  isSyntheticRef,
  parseStructuralRef,
} from "@ayme-dev/core/structural-observation";
import { resolvePageStateRefs, type AymeNode } from "./pageState";
import { RefResolutionError, ToolInputError } from "./errors";

/**
 * Package-internal: the node a call's Structural Ref addresses now. The one
 * place a requested ref is read and resolved, for Browser Tools, Custom
 * Tools and collection tools alike: a value that is not a ref is refused as
 * input; a ref that names nothing now, or names an observation-only node,
 * fails as `Cannot ${label} ref "e1": …`.
 */
export async function resolveRefTarget(
  label: string,
  requested: string,
  currentDocument: Document
): Promise<AymeNode> {
  const requestedRef = parseStructuralRef(requested);
  if (requestedRef === undefined)
    throw new ToolInputError(
      `The ref "${requested}" is not a Structural Ref. Pass a ref from snapshot, such as e5.`
    );
  const fail = (reason: string) =>
    new RefResolutionError(`Cannot ${label} ref "${requestedRef}": ${reason}.`);

  if (isSyntheticRef(requestedRef))
    throw fail("synthetic observation-only ref");

  const resolution = (
    await resolvePageStateRefs(currentDocument, requestedRef)
  )[0]!;
  if (resolution.status === "unresolved") throw fail(resolution.reason);
  if (isSyntheticRef(resolution.node.ref))
    throw fail("synthetic observation-only ref");
  return resolution.node;
}
