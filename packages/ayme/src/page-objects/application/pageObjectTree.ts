import type { Locator } from "@playwright/test";
import {
  parseStructuralRef,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import type { PageStateCapture } from "../../page-state/domain";
import type { PomComponentManifest, PomManifest } from "../../shared";
import type { PomInstanceObservation } from "../domain/pomInstance";
import { componentsOf, type PomTargetSource } from "../domain/pomTree";
import { elementText, type ChildElement } from "../domain/elementText";
import type {
  PageObjectTreeChild,
  PageObjectTreeNode,
  PageObjectTreeRead,
} from "../domain/pageObjectTreeText";
import type { PageDriver } from "./pageDriver";
import type { PageObjectIds } from "./pageObjectIds";

/** A registered Page Object as its last observation found it. */
export type TreeRegistration = {
  manifest: PomManifest;
  instances: readonly PomInstanceObservation[] | undefined;
  targetSources: readonly PomTargetSource[];
  rootMemberPaths: ReadonlySet<string>;
};

/**
 * Package-internal: the Page Object Tree of `registrations`, as their last
 * observation found them: each present Page Object, nested as the models
 * nest (a present one inside one that is not takes its place), one with a
 * root with its Page Object id, and each declared element
 * child as its elements' subtrees in a capture of the page that `capture`
 * takes after that observation, keeping each of those elements as a node;
 * its elements are the ones the child's Locator resolves to now. Ids are
 * given in the order the tree shows the roots.
 */
export async function readPageObjectTree(
  driver: Pick<PageDriver, "refs" | "currentRefs">,
  registrations: readonly TreeRegistration[],
  ids: PageObjectIds,
  capture: (keep: readonly string[]) => Promise<PageStateCapture>
): Promise<PageObjectTreeRead> {
  const pending: PendingChild[] = [];
  const reads = registrations.flatMap((registration) => {
    const instances = new Map(
      (registration.instances ?? []).map((instance) => [
        instance.path,
        instance,
      ])
    );
    const page = instances.get("");
    if (!page) return [];
    const read: Read = {
      pending,
      label: registration.manifest.className,
      components: componentsOf(registration.manifest),
      instances,
      sources: new Map(
        registration.targetSources.map((source) => [source.path, source])
      ),
      rootMemberPaths: registration.rootMemberPaths,
      roots: [],
    };
    return [{ read, page, manifest: registration.manifest }];
  });
  const tree: PageObjectTreeNode[] = [];
  for (const { read, page, manifest } of reads)
    tree.push(...readNodes(read, page, manifest));
  // The elements each element child's Locator resolves to now, then one
  // capture that keeps every one of them as a node, read in its place.
  const refs = await Promise.all(
    pending.map(({ locator }) => driver.refs(locator).catch(() => []))
  );
  const captured = await capture(refs.flat());
  // A ref minted before the capture gives way to the one it marked the
  // element with, such as after the element's name changed.
  const current = await driver.currentRefs(refs.flat());
  let at = 0;
  pending.forEach(({ child, siblings }, index) => {
    const named = refs[index]!.map((ref) => current[at++] ?? ref);
    child.elements = elementsIn(captured, named);
    if (!child.collection && child.elements.length === 0)
      siblings.splice(siblings.indexOf(child), 1);
  });
  // One read of the ids for every root, in the order the tree shows them.
  const roots = reads.flatMap(({ read }) => read.roots);
  const given = await ids.rootsOf(
    roots.map(({ node, ref }) => ({ className: node.className, ref }))
  );
  roots.forEach(({ node }, index) => {
    const id = given[index]?.id;
    if (id) node.id = id;
  });
  return {
    objects: tree,
    tree: captured.tree,
    ...(captured.document && { document: captured.document }),
  };
}

type MutableNode = {
  -readonly [K in keyof PageObjectTreeNode]: PageObjectTreeNode[K];
};

/** An element child of the tree, whose elements the capture gives. */
type PendingChild = {
  child: { -readonly [K in keyof ElementsChild]: ElementsChild[K] };
  locator: Locator;
  /** The children it is one of, which drop a single child with no element. */
  siblings: PageObjectTreeChild[];
};

type ElementsChild = Extract<PageObjectTreeChild, { kind: "elements" }>;

type Read = {
  /** The element children of the tree, read once the capture is taken. */
  pending: PendingChild[];
  label: string;
  components: ReadonlyMap<string, PomComponentManifest>;
  instances: ReadonlyMap<string, PomInstanceObservation>;
  sources: ReadonlyMap<string, PomTargetSource>;
  rootMemberPaths: ReadonlySet<string>;
  /** The nodes with a root, in tree order, and the ref their root had. */
  roots: { node: MutableNode; ref: string }[];
};

const join = (prefix: string, name: string) =>
  prefix ? `${prefix}.${name}` : name;

function readNode(
  read: Read,
  instance: PomInstanceObservation,
  manifest: Pick<PomComponentManifest, "members">
): PageObjectTreeNode {
  const children: PageObjectTreeChild[] = [];
  const node: MutableNode = { className: instance.className, children };
  const rootRef = instance.root?.present ? instance.root.ref : undefined;
  if (rootRef) read.roots.push({ node, ref: rootRef });
  for (const member of manifest.members) {
    const path = join(instance.path, member.memberName);
    if (member.kind === "locator") {
      if (read.rootMemberPaths.has(path)) continue;
      const source = read.sources.get(join(read.label, path));
      if (!source) continue;
      const child: PendingChild["child"] = {
        kind: "elements",
        name: member.memberName,
        collection: member.collection === true,
        elements: [],
      };
      children.push(child);
      read.pending.push({ child, locator: source.locator, siblings: children });
      continue;
    }
    const component = read.components.get(member.componentClassName);
    if (!component) continue;
    const instances = childInstances(read, path, member.collection === true);
    const objects = instances.flatMap((child) =>
      readNodes(read, child, component)
    );
    const [only] = instances;
    if (!member.collection && only?.present && objects[0])
      children.push({
        kind: "object",
        name: member.memberName,
        object: objects[0],
      });
    // An absent single member shows the present Page Objects inside it as
    // a list, which a change matches by id, however many there are.
    else if (member.collection || objects.length > 0)
      children.push({ kind: "objects", name: member.memberName, objects });
  }
  return node;
}

/** The instances observed at a child member's `path`: its one, or a collection's in order. */
function childInstances(
  read: Read,
  path: string,
  collection: boolean
): PomInstanceObservation[] {
  if (!collection) {
    const child = read.instances.get(path);
    return child ? [child] : [];
  }
  const children: PomInstanceObservation[] = [];
  for (
    let index = 0, child = read.instances.get(`${path}[0]`);
    child;
    child = read.instances.get(`${path}[${++index}]`)
  )
    children.push(child);
  return children;
}

/**
 * `instance` as the tree shows it: its node while it is present; else, in
 * its place, the present Page Objects inside it, since a child can be on
 * the page while the Page Object it is reached through is not (ADR-0061),
 * and its tools are listed.
 */
function readNodes(
  read: Read,
  instance: PomInstanceObservation,
  manifest: Pick<PomComponentManifest, "members">
): PageObjectTreeNode[] {
  if (instance.present) return [readNode(read, instance, manifest)];
  const nodes: PageObjectTreeNode[] = [];
  for (const member of manifest.members) {
    if (member.kind === "locator") continue;
    const component = read.components.get(member.componentClassName);
    if (!component) continue;
    const path = join(instance.path, member.memberName);
    for (const child of childInstances(read, path, member.collection === true))
      nodes.push(...readNodes(read, child, component));
  }
  return nodes;
}

/**
 * The elements `refs` name, by the ref `capture` gives each, with its
 * subtree there. One the capture holds no node of, such as one in an
 * excluded subtree, is left out.
 */
function elementsIn(
  capture: PageStateCapture,
  refs: readonly string[]
): ChildElement[] {
  return refs.flatMap((ref) => {
    const named = capturedRef(capture, ref);
    if (named === undefined) return [];
    const text = elementText(capture.tree, named);
    return text.trim() ? [{ ref: named, text }] : [];
  });
}

/**
 * The ref `capture` gives the element the page names `ref` now: `ref` itself
 * while the capture holds it, or the one it gave the element a probe named
 * by `ref` first.
 */
function capturedRef(
  capture: PageStateCapture,
  ref: string
): AriaRef | undefined {
  for (const candidate of [ref, capture.renamed?.get(ref)]) {
    const parsed =
      candidate === undefined ? undefined : parseStructuralRef(candidate);
    if (parsed !== undefined && capture.tree.hasNode(parsed)) return parsed;
  }
  return undefined;
}
