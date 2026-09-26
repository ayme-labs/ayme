import type { MonotonicTimeMs } from "./MonotonicTimeMs";
import type {
  JsonValue,
  StructuralEnrichmentKind,
} from "../tree/StructuralEnrichment";
import type { StructuralTree } from "../tree/StructuralTree";
import type { AriaRef } from "../tree/StructuralTypes";
import type { PageId } from "./PageId";

const structuralEnrichmentEvidenceBrand: unique symbol = Symbol(
  "StructuralEnrichmentEvidence"
);

export type StructuralEnrichmentEvidence = Readonly<{
  [structuralEnrichmentEvidenceBrand]: true;
}>;

type StoredStructuralEnrichmentEvidence = Readonly<{
  kind: StructuralEnrichmentKind;
  resolve(tree: StructuralTree): Promise<ReadonlyMap<AriaRef, JsonValue>>;
}>;

const storedEvidence = new WeakMap<
  StructuralEnrichmentEvidence,
  StoredStructuralEnrichmentEvidence
>();

export function defineStructuralEnrichmentEvidence<T extends JsonValue>(
  kind: StructuralEnrichmentKind<T>,
  resolve: (tree: StructuralTree) => Promise<ReadonlyMap<AriaRef, T>>
): StructuralEnrichmentEvidence {
  const evidence: StructuralEnrichmentEvidence = Object.freeze({
    [structuralEnrichmentEvidenceBrand]: true,
  });
  storedEvidence.set(evidence, {
    kind,
    resolve: async (tree) => await resolve(tree),
  });
  return evidence;
}

export function storedStructuralEnrichmentEvidence(
  evidence: StructuralEnrichmentEvidence
): StoredStructuralEnrichmentEvidence {
  const stored = storedEvidence.get(evidence);
  if (stored === undefined)
    throw new TypeError("Invalid structural enrichment evidence.");
  return stored;
}

export interface StructuralTreeEvidence {
  readonly pageId: PageId;
  readonly capturedAt: MonotonicTimeMs;
  resolve(): Promise<StructuralTree>;
}
