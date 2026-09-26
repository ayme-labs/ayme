import { MonotonicTimeMsSchema, type MonotonicTimeMs } from "./MonotonicTimeMs";
import type {
  JsonValue,
  StructuralEnrichmentKind,
} from "../tree/StructuralEnrichment";
import { StructuralNode } from "../tree/StructuralNode";
import { StructuralTree } from "../tree/StructuralTree";
import type { AriaRef } from "../tree/StructuralTypes";
import { SyntheticAriaRefFactory } from "../tree/SyntheticAriaRefFactory";
import type {
  LiveAriaSnapshot,
  LiveAriaSnapshotSource,
} from "./LiveAriaSnapshot";
import type { PageId } from "./PageId";
import {
  storedStructuralEnrichmentEvidence,
  type StructuralEnrichmentEvidence,
  type StructuralTreeEvidence,
} from "./StructuralTreeEvidence";

export interface StructuralCapture {
  readonly pageId: PageId;
  readonly capturedAt: MonotonicTimeMs;
  asEvidence(
    enrichment?: readonly StructuralEnrichmentEvidence[]
  ): StructuralTreeEvidence;
  resolveUndistilledTree(): Promise<StructuralTree>;
}

type StructuralTreeCaptureServiceOptions = Readonly<{
  snapshotSource: LiveAriaSnapshotSource;
  clock: { now(): MonotonicTimeMs };
  refFactory: SyntheticAriaRefFactory;
}>;

export class StructuralTreeCaptureService {
  private readonly _snapshotSource: LiveAriaSnapshotSource;
  private readonly _clock: { now(): MonotonicTimeMs };
  private readonly _refFactory: SyntheticAriaRefFactory;
  private readonly _undistilledRefFactory = new SyntheticAriaRefFactory();

  constructor(options: StructuralTreeCaptureServiceOptions) {
    this._snapshotSource = options.snapshotSource;
    this._clock = options.clock;
    this._refFactory = options.refFactory;
  }

  async capture(pageId: PageId): Promise<StructuralCapture> {
    const snapshot = await this._snapshotSource.captureAriaSnapshot(pageId);
    const capturedAt = MonotonicTimeMsSchema.parse(this._clock.now());
    return this._capture(pageId, capturedAt, snapshot);
  }

  private _capture(
    pageId: PageId,
    capturedAt: MonotonicTimeMs,
    snapshot: LiveAriaSnapshot
  ): StructuralCapture {
    let distilledTreePromise: Promise<StructuralTree> | undefined;
    let undistilledTreePromise: Promise<StructuralTree> | undefined;
    const resolveDistilledTree = () =>
      (distilledTreePromise ??= this._parse(
        snapshot.distilledYaml,
        this._refFactory
      ));
    return Object.freeze({
      pageId,
      capturedAt,
      asEvidence: (enrichment: readonly StructuralEnrichmentEvidence[] = []) =>
        this._evidence(
          pageId,
          capturedAt,
          resolveDistilledTree,
          Object.freeze([...enrichment])
        ),
      resolveUndistilledTree: () =>
        (undistilledTreePromise ??= this._parse(
          snapshot.undistilledYaml,
          this._undistilledRefFactory
        )),
    });
  }

  private _evidence(
    pageId: PageId,
    capturedAt: MonotonicTimeMs,
    resolveDistilledTree: () => Promise<StructuralTree>,
    enrichment: readonly StructuralEnrichmentEvidence[]
  ): StructuralTreeEvidence {
    let treePromise: Promise<StructuralTree> | undefined;
    return Object.freeze({
      pageId,
      capturedAt,
      resolve: () =>
        (treePromise ??= this._resolveEvidence(
          resolveDistilledTree,
          enrichment
        )),
    });
  }

  private async _resolveEvidence(
    resolveDistilledTree: () => Promise<StructuralTree>,
    enrichment: readonly StructuralEnrichmentEvidence[]
  ): Promise<StructuralTree> {
    let tree = await resolveDistilledTree();
    for (const evidence of enrichment) {
      const stored = storedStructuralEnrichmentEvidence(evidence);
      const values = await stored.resolve(tree);
      tree = this._attachEnrichment(tree, stored.kind, values);
    }
    return tree;
  }

  private async _parse(
    yaml: string,
    refFactory: SyntheticAriaRefFactory
  ): Promise<StructuralTree> {
    return StructuralTree.fromAriaSnapshotYaml(yaml, refFactory);
  }

  private _attachEnrichment(
    tree: StructuralTree,
    kind: StructuralEnrichmentKind,
    values: ReadonlyMap<AriaRef, JsonValue>
  ): StructuralTree {
    const attach = (node: StructuralNode): StructuralNode => {
      const children = node.children.map((child) =>
        typeof child === "string" ? child : attach(child)
      );
      const rebuilt = node.copy({ children });
      const value = values.get(node.ref);
      return value === undefined
        ? rebuilt
        : rebuilt.attachEnrichment(kind, value);
    };
    return new StructuralTree(attach(tree.root), this._refFactory);
  }
}
