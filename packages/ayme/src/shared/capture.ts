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

/**
 * An element predicate of the Browser Tools (ADR-0023), evaluated in the
 * page: which elements click and hover, type and fill, check, uncheck and
 * select_option take.
 */
export type Predicate =
  "clickable" | "fillable" | "checkable" | "uncheckable" | "select";

/**
 * The key a Custom Tool's filter keeps its refs under in `Capture.accepted`,
 * apart from the predicates' keys, so a tool named like a predicate keeps its own.
 */
export function toolFilterKey(name: string): string {
  return `tool:${name}`;
}

/** Every predicate, in the order the Browser Tools use them. */
export const PREDICATES: readonly Predicate[] = [
  "clickable",
  "fillable",
  "checkable",
  "uncheckable",
  "select",
];

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
  /**
   * For each predicate the host asked, under its name, and each Custom Tool's
   * filter it was given, under `tool:<name>`, the refs of the captured elements it keeps,
   * in capture order: the closed sets the Goal Loop's options come from.
   * Absent when the host asked for none.
   */
  accepted?: Record<string, string[]>;
  /**
   * The mark this capture gave each element a probe or a reach had named by a
   * synthetic ref first, under that ref: what tells a ref read before the
   * capture from the one the capture shows. Absent when none was renamed.
   */
  renamed?: Record<string, string>;
};

/**
 * What an action came to, once its page settled or a full load started:
 * `stable` says whether the page went quiet before the deadline, and
 * `after` is the page after it. `threw` carries what perform threw, or else
 * why capturing the page after it failed, and then has no `after`. A full
 * load's `after` is the old document's last capture, when the old document
 * saw the load start.
 */
export type ActionOutcome<T> =
  | { kind: "settled"; result: T; stable: boolean; after: Capture }
  | { kind: "threw"; error: unknown; stable: boolean; after?: Capture }
  | { kind: "loading"; url: string; after?: Capture };
