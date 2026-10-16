import {
  parseStructuralRef,
  refWrittenOtherwise,
} from "@ayme-dev/core/structural-observation";
import {
  resolvePageStateRefs,
  type AymeNode,
  type RefResolution,
} from "./pageState";
import { asSentence, RefResolutionError, ToolInputError } from "./errors";

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
  "unknown-ref": "no snapshot of the current document issued it",
  removed: "it is no longer on the page",
  ambiguous: "it cannot be matched unambiguously to the current page",
  "no-element": "it has no element on the page now",
};

/** The one format every target failure shares; a reason that ends a sentence keeps its mark. */
function targetFailure(label: string, target: string, reason: string): string {
  return asSentence(`Cannot ${label} ${target}: ${reason}`);
}

/**
 * Package-internal: the message for a tool's ref that cannot be used:
 * `Cannot click ref "e1": …`.
 */
export function refFailure(
  label: string,
  requested: string,
  reason: string
): string {
  return targetFailure(label, `ref "${requested}"`, reason);
}

/**
 * Package-internal: the message for a tool's selector that cannot be used,
 * `Cannot click "#save": …`, with the sentence `hint` adds, if any.
 */
export function selectorFailure(
  label: string,
  requested: string,
  reason: string,
  hint?: string
): string {
  return `${targetFailure(label, `"${requested}"`, reason)}${hint ? ` ${hint}` : ""}`;
}

/**
 * Package-internal: the node a tool's Structural Ref addresses now, the one
 * resolver every tool's `ref` goes through; a synthetic ref resolves like any
 * other. A value that is not a Structural Ref or a ref that names nothing
 * now fails as `Cannot ${label} ref "e1": …`; the first as input, naming the
 * Structural Ref it writes another way, if it does.
 */
export async function resolveRef(
  requested: string,
  label: string,
  currentDocument: Document
): Promise<AymeNode> {
  const failure = (reason: string) => refFailure(label, requested, reason);
  const requestedRef = parseStructuralRef(requested);
  if (requestedRef === undefined) {
    const hint = refHint(requested);
    throw new ToolInputError(
      `${failure("not a Structural Ref")}${hint ? ` ${hint}` : ""}`
    );
  }
  const resolution = (
    await resolvePageStateRefs(currentDocument, requestedRef)
  )[0]!;
  if (resolution.status === "unresolved")
    throw new RefResolutionError(failure(UNRESOLVED[resolution.reason]));
  return resolution.node;
}
