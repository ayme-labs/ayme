import { StructuralTree } from "../tree/StructuralTree";
import type { AriaRef } from "../tree/StructuralTypes";
import type { StructuralActionId } from "./StructuralAction";
import type { VisitId } from "./Visit";

/** Where in the history a node appeared or disappeared. */
export type StructuralLifecycleMoment = {
  readonly visitId: VisitId | null;
  /**
   * The action the observation followed: the action it was captured for when
   * it is an action's after observation, otherwise the page's latest started
   * action; null before any action.
   */
  readonly afterActionId: StructuralActionId | null;
};

export type StructuralIdentityLifecycle = {
  readonly appeared: StructuralLifecycleMoment;
  /** Set while the identity has no current ref. */
  readonly disappeared: StructuralLifecycleMoment | null;
};

export type StructuralIdentityResolution =
  | {
      readonly status: "resolved";
      readonly requestedRef: AriaRef;
      readonly currentRef: AriaRef;
    }
  | {
      readonly status: "unresolved";
      readonly requestedRef: AriaRef;
      /**
       * - `unknown-ref`: the ledger never observed this ref.
       * - `removed`: the identity this ref belonged to is no longer on the page.
       * - `ambiguous`: several nodes of a later observation claimed this ref's
       *   identity and none of them could be told to continue it. Never a ref
       *   the latest observation carries. Not "matches several elements".
       */
      readonly reason: "unknown-ref" | "removed" | "ambiguous";
    };

type Identity = {
  currentRef: AriaRef | null;
  unresolvedReason: "removed" | "ambiguous" | null;
  appeared: StructuralLifecycleMoment;
  disappeared: StructuralLifecycleMoment | null;
};

/**
 * Best-effort node continuity across successive observations of one page.
 *
 * A ref is capture-scoped; the ledger makes every ref it has observed an alias
 * of an identity. Reconciling each observation against the previous one
 * retargets an identity to its current ref along a reconciliation lineage.
 * Removal and ambiguity are explicit unresolved states, and each identity
 * records when it appeared and disappeared. Nothing here assumes a browser.
 */
export class StructuralIdentityLedger {
  private _baseline: StructuralTree | null = null;
  private _currentByRef = new Map<AriaRef, Identity>();
  private readonly _byAlias = new Map<AriaRef, Identity>();

  /**
   * Reconcile `tree` against the previous observation and carry identities
   * forward. A tree in which two nodes share a ref is rejected before anything
   * changes, so the next observation reconciles against the last accepted one.
   */
  advance(tree: StructuralTree, moment: StructuralLifecycleMoment): void {
    const duplicateRef = tree.findDuplicateRef();
    if (duplicateRef !== null)
      throw new Error(
        `Structural Ref ${duplicateRef} names more than one node in one observation.`
      );

    const baseline = this._baseline;
    if (baseline === null) {
      for (const node of tree.getAllNodes()) {
        const identity = this._createIdentity(moment);
        identity.currentRef = node.ref;
        this._byAlias.set(node.ref, identity);
        this._currentByRef.set(node.ref, identity);
      }
      this._baseline = tree;
      return;
    }

    const previousByRef = this._currentByRef;
    const reconciled = StructuralTree.reconcile(baseline, tree);
    this._baseline = tree;

    // A capture's ref stays on one element, so a node whose ref the ledger has
    // observed claims that ref's identity, whatever reconciliation matched it
    // to. Only a node with a new ref claims through its reconciliation match.
    const claims = tree.getAllNodes().map((node) => {
      const own = previousByRef.get(node.ref) ?? this._byAlias.get(node.ref);
      if (own !== undefined) return { node, identity: own, byOwnRef: true };
      const beforeRef = reconciled.getBeforeNodeForAfterRef(node.ref)?.ref;
      const lineage =
        beforeRef === undefined ? undefined : previousByRef.get(beforeRef);
      return { node, identity: lineage, byOwnRef: false };
    });

    const claimantsByIdentity = new Map<Identity, typeof claims>();
    for (const claim of claims) {
      if (claim.identity === undefined) continue;
      const claimants = claimantsByIdentity.get(claim.identity) ?? [];
      claimants.push(claim);
      claimantsByIdentity.set(claim.identity, claimants);
    }

    // An identity continues as the node still carrying its current ref, else
    // its one claimant by own ref, else its one claimant by match. With
    // several claimants and none of those, no node continues it.
    const ambiguous = new Set<Identity>();
    const winners = new Set<(typeof claims)[number]>();
    for (const [identity, claimants] of claimantsByIdentity) {
      const byOwnRef = claimants.filter((claim) => claim.byOwnRef);
      const winner =
        claimants.find((claim) => claim.node.ref === identity.currentRef) ??
        (byOwnRef.length === 1
          ? byOwnRef[0]
          : byOwnRef.length === 0 && claimants.length === 1
            ? claimants[0]
            : undefined);
      if (winner) winners.add(winner);
      if (claimants.length > 1) ambiguous.add(identity);
    }

    const nextByRef = new Map<AriaRef, Identity>();
    const retained = new Set<Identity>();
    for (const claim of claims) {
      const { node } = claim;
      const selected = winners.has(claim)
        ? claim.identity!
        : this._createIdentity(moment);
      selected.currentRef = node.ref;
      selected.unresolvedReason = null;
      selected.disappeared = null;
      // A ref printed now names its node now, even if it once named an
      // identity another node continues.
      this._byAlias.set(node.ref, selected);
      nextByRef.set(node.ref, selected);
      retained.add(selected);
    }

    for (const [beforeRef, identity] of previousByRef) {
      if (retained.has(identity)) continue;
      identity.currentRef = null;
      identity.disappeared = moment;
      identity.unresolvedReason =
        ambiguous.has(identity) || reconciled.wasBeforeRefAmbiguous(beforeRef)
          ? "ambiguous"
          : "removed";
    }
    for (const identity of ambiguous)
      if (!retained.has(identity)) identity.unresolvedReason = "ambiguous";

    this._currentByRef = nextByRef;
  }

  /** Resolve any ref the ledger has observed to its identity's current ref. */
  resolve(requestedRef: AriaRef): StructuralIdentityResolution {
    const identity = this._byAlias.get(requestedRef);
    if (!identity)
      return { status: "unresolved", requestedRef, reason: "unknown-ref" };
    if (identity.currentRef === null)
      return {
        status: "unresolved",
        requestedRef,
        reason: identity.unresolvedReason ?? "removed",
      };
    return {
      status: "resolved",
      requestedRef,
      currentRef: identity.currentRef,
    };
  }

  /**
   * Whether two observed refs are aliases of one identity: the same node
   * followed across captures. A ref the ledger has not observed is only the
   * same as itself.
   */
  sameIdentity(a: AriaRef, b: AriaRef): boolean {
    if (a === b) return true;
    const identity = this._byAlias.get(a);
    return identity !== undefined && identity === this._byAlias.get(b);
  }

  /** When the identity behind `ref` appeared and, if it has, disappeared. */
  lifecycle(ref: AriaRef): StructuralIdentityLifecycle | undefined {
    const identity = this._byAlias.get(ref);
    return identity
      ? { appeared: identity.appeared, disappeared: identity.disappeared }
      : undefined;
  }

  private _createIdentity(moment: StructuralLifecycleMoment): Identity {
    return {
      currentRef: null,
      unresolvedReason: null,
      appeared: moment,
      disappeared: null,
    };
  }
}
