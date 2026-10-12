import {
  isSyntheticRef,
  parseStructuralRef,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import { resolvePageStateRefs, type AymeNode } from "./pageState";
import { RefResolutionError, ToolInputError } from "./errors";

/**
 * Package-internal: the Structural Ref a call's `ref` input is. A value that
 * is not one, such as a selector or a typo, is refused as input.
 */
export function requireStructuralRef(requested: string): AriaRef {
  const ref = parseStructuralRef(requested);
  if (ref === undefined)
    throw new ToolInputError(
      `The ref "${requested}" is not a Structural Ref. Pass a ref from snapshot, such as e5.`
    );
  return ref;
}

/**
 * Package-internal: the element node a Browser Tool's or Custom Tool's
 * Structural Ref addresses now. A ref that names nothing now, or names an
 * observation-only node, fails as `Cannot ${label} ref "e1": …`.
 */
export async function resolveRefTarget(
  label: string,
  requested: string,
  currentDocument: Document
): Promise<AymeNode> {
  const requestedRef = requireStructuralRef(requested);
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
