import { StructuralTree } from "../tree/StructuralTree";
import type { AriaRef } from "../tree/StructuralTypes";
import type { StructuralActionId } from "./StructuralAction";
import type { VisitId } from "./Visit";

/** Where in the history a node appeared or disappeared. */
export type StructuralLifecycleMoment = {
  readonly visitId: VisitId | null;
  /** The latest action started before the observation; null before any action. */
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
  private baseline: StructuralTree | null = null;
  private currentByRef = new Map<AriaRef, Identity>();
  private readonly byAlias = new Map<AriaRef, Identity>();

  /** Reconcile `tree` against the previous observation; null for the first. */
  advance(
    tree: StructuralTree,
    moment: StructuralLifecycleMoment
  ): StructuralTree | null {
    const baseline = this.baseline;
    this.baseline = tree;
    if (baseline === null) {
      for (const node of tree.getAllNodes()) {
        const identity = this.createIdentity(moment, null);
        identity.currentRef = node.ref;
        this.bindAlias(node.ref, identity);
        this.currentByRef.set(node.ref, identity);
      }
      return null;
    }

    const previousByRef = this.currentByRef;
    const reconciled = StructuralTree.reconcile(baseline, tree);
    const assignments = tree.getAllNodes().map((node) => {
      const beforeRef = reconciled.getBeforeNodeForAfterRef(node.ref)?.ref;
      const candidates = new Set<Identity>();
      const current = previousByRef.get(node.ref);
      const historical = this.byAlias.get(node.ref);
      const lineage =
        beforeRef === undefined ? undefined : previousByRef.get(beforeRef);
      if (current) candidates.add(current);
      if (historical) candidates.add(historical);
      if (lineage) candidates.add(lineage);
      return {
        node,
        candidates,
        hasAmbiguousCandidate: [...candidates].some(
          (identity) => identity.unresolvedReason === "ambiguous"
        ),
      };
    });

    const claimsByIdentity = new Map<Identity, number>();
    for (const { candidates } of assignments) {
      if (candidates.size !== 1) continue;
      const identity = [...candidates][0]!;
      claimsByIdentity.set(identity, (claimsByIdentity.get(identity) ?? 0) + 1);
    }

    const ambiguous = new Set<Identity>();
    for (const { candidates, hasAmbiguousCandidate } of assignments) {
      if (candidates.size > 1 || hasAmbiguousCandidate)
        for (const identity of candidates) ambiguous.add(identity);
    }
    for (const [identity, claims] of claimsByIdentity)
      if (claims > 1) ambiguous.add(identity);

    const nextByRef = new Map<AriaRef, Identity>();
    const retained = new Set<Identity>();
    for (const { node, candidates, hasAmbiguousCandidate } of assignments) {
      const identity = candidates.size === 1 ? [...candidates][0] : undefined;
      if (
        candidates.size > 1 ||
        hasAmbiguousCandidate ||
        (identity !== undefined && claimsByIdentity.get(identity)! > 1)
      ) {
        if (!this.byAlias.has(node.ref))
          this.byAlias.set(node.ref, this.createIdentity(moment, "ambiguous"));
        continue;
      }

      const selected = identity ?? this.createIdentity(moment, null);
      selected.currentRef = node.ref;
      selected.unresolvedReason = null;
      selected.disappeared = null;
      this.bindAlias(node.ref, selected);
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

    this.currentByRef = nextByRef;
    return reconciled;
  }

  /** Resolve any ref the ledger has observed to its identity's current ref. */
  resolve(requestedRef: AriaRef): StructuralIdentityResolution {
    const identity = this.byAlias.get(requestedRef);
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

  /** When the identity behind `ref` appeared and, if it has, disappeared. */
  lifecycle(ref: AriaRef): StructuralIdentityLifecycle | undefined {
    const identity = this.byAlias.get(ref);
    return identity
      ? { appeared: identity.appeared, disappeared: identity.disappeared }
      : undefined;
  }

  private createIdentity(
    moment: StructuralLifecycleMoment,
    unresolvedReason: Identity["unresolvedReason"]
  ): Identity {
    return {
      currentRef: null,
      unresolvedReason,
      appeared: moment,
      disappeared: unresolvedReason === null ? null : moment,
    };
  }

  private bindAlias(ref: AriaRef, identity: Identity): void {
    const existing = this.byAlias.get(ref);
    if (existing !== undefined && existing !== identity)
      throw new Error(
        `Structural Ref alias ${ref} is already bound to another identity.`
      );
    this.byAlias.set(ref, identity);
  }
}
