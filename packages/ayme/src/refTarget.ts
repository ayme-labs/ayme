import {
  isSyntheticRef,
  parseStructuralRef,
  refWrittenOtherwise,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import {
  resolvePageStateRefs,
  type AymeNode,
  type RefResolution,
} from "./pageState";
import { RefResolutionError, ToolInputError } from "./errors";

/**
 * Package-internal: the sentence saying which Structural Ref `requested`
 * writes another way, if it does.
 */
export function refHint(requested: string): string | undefined {
  const ref = refWrittenOtherwise(requested);
  return ref && `It writes the Structural Ref ${ref} another way.`;
}

/** Why a ref did not resolve, by its ledger code. */
const UNRESOLVED: Record<
  Extract<RefResolution, { status: "unresolved" }>["reason"],
  string
> = {
  "unknown-ref": "no snapshot issued it",
  removed: "it is no longer on the page",
  ambiguous: "it cannot be matched unambiguously to the current page",
  "no-element": "it has no element on the page now",
};

/**
 * Package-internal: the message for a tool's ref that cannot be used, the
 * one format every ref failure shares.
 */
export function refFailure(
  label: string,
  requested: string,
  reason: string
): string {
  return `Cannot ${label} ref "${requested}": ${reason}.`;
}

/**
 * Package-internal: the node a tool's Structural Ref addresses now, the one
 * resolver every tool's `ref` goes through. A synthetic ref, which names an
 * observation-only node, resolves only when `synthetic` is `"allow"`: a
 * collection tool's Page Object Root may have one. A value that is not a
 * Structural Ref, a ref that names nothing now, or a refused synthetic one
 * fails as `Cannot ${label} ref "e1": …`; the first as input, naming the
 * Structural Ref it writes another way, if it does.
 */
export async function resolveRef(
  requested: string,
  { synthetic }: { synthetic: "allow" | "refuse" },
  label: string,
  currentDocument: Document
): Promise<AymeNode> {
  const failure = (reason: string) => refFailure(label, requested, reason);
  const fail = (reason: string) => new RefResolutionError(failure(reason));
  const requestedRef = parseStructuralRef(requested);
  if (requestedRef === undefined) {
    const hint = refHint(requested);
    throw new ToolInputError(
      `${failure("not a Structural Ref")}${hint ? ` ${hint}` : ""}`
    );
  }
  const refused = (ref: AriaRef) =>
    synthetic === "refuse" && isSyntheticRef(ref);

  if (refused(requestedRef)) throw fail("synthetic observation-only ref");

  const resolution = (
    await resolvePageStateRefs(currentDocument, requestedRef)
  )[0]!;
  if (resolution.status === "unresolved")
    throw fail(UNRESOLVED[resolution.reason]);
  if (refused(resolution.node.ref))
    throw fail("synthetic observation-only ref");
  return resolution.node;
}
