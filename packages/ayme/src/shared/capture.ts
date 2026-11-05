// The In-page Module's capture as every host reads it: plain data only, so
// it crosses into Node as it is (ADR-0049).

/** One document's identity: a new token is a new document. */
export type DocumentToken = string & { readonly __brand: "DocumentToken" };

/**
 * A Page Object Root of the capturing host, its labels coalesced per
 * element: by its own node's Structural Ref, or, when it has no node of its
 * own, by the synthetic ref the module minted for its element and the refs
 * of the nodes inside it, which the host places it over.
 */
export type CapturedRoot =
  | { labels: string[]; ref: string }
  | { labels: string[]; syntheticRef: string; descendantRefs: string[] };

/** One capture of one document: Ayme's dual capture, for one host. */
export type Capture = {
  document: DocumentToken;
  url: string;
  /** The distilled page, a Structural Ref on every node. */
  distilledText: string;
  /** Every node of the page, the distilled text's included. */
  fullText: string;
  /** Refs inside an ignored subtree or under an absent Page Object Root. */
  excludedRefs: string[];
  /** This host's present roots: referenced first, then the others from outer to inner. */
  roots: CapturedRoot[];
};
