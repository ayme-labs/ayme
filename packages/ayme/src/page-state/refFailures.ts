import { refWrittenOtherwise } from "@ayme-dev/core/structural-observation";
import { asSentence } from "../shared";
import type { RefResolution } from "./structuralPageState";

/**
 * Package-internal: the sentence saying which Structural Ref `requested`
 * writes another way, if it does.
 */
export function refHint(requested: string): string | undefined {
  const ref = refWrittenOtherwise(requested);
  return ref && `It writes the Structural Ref ${ref} another way.`;
}

/** Why a ref did not resolve, by its ledger code. */
export const UNRESOLVED: Record<
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
