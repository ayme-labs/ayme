import {
  parseStructuralRef,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import { RefResolutionError, ToolInputError } from "../shared";
import { refFailure, refHint, UNRESOLVED } from "./refFailures";
import type { AymeNode, RefResolution } from "./structuralPageState";

/** Resolves refs against the page as it is now. */
export type ResolveRefs = (...refs: AriaRef[]) => Promise<RefResolution[]>;

/**
 * Package-internal: the node a tool's Structural Ref addresses now, through
 * `resolveRefs`; a synthetic ref resolves like any other. A value that is
 * not a Structural Ref or a ref that names nothing now fails as
 * `Cannot ${label} ref "e1": …`; the first as input, naming the Structural
 * Ref it writes another way, if it does.
 */
export async function resolveRequestedRef(
  requested: string,
  label: string,
  resolveRefs: ResolveRefs
): Promise<AymeNode> {
  const failure = (reason: string) => refFailure(label, requested, reason);
  const requestedRef = parseStructuralRef(requested);
  if (requestedRef === undefined) {
    const hint = refHint(requested);
    throw new ToolInputError(
      `${failure("not a Structural Ref")}${hint ? ` ${hint}` : ""}`
    );
  }
  const resolution = (await resolveRefs(requestedRef))[0]!;
  if (resolution.status === "unresolved")
    throw new RefResolutionError(failure(UNRESOLVED[resolution.reason]));
  return resolution.node;
}
