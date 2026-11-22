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
 * child as its elements' subtrees in `capture`, a capture of the page taken
 * after that observation; its elements are the ones the child's Locator
 * resolves to now, and one the capture holds no node of is read on its own. Ids are given in the order the tree shows the roots.
 */
export async function readPageObjectTree(
  driver: Pick<PageDriver, "ariaSnapshot" | "refs">,
  registrations: readonly TreeRegistration[],
  ids: PageObjectIds,
  capture: PageStateCapture
): Promise<PageObjectTreeRead> {
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
      driver,
      capture,
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
    tree.push(...(await readNodes(read, page, manifest)));
  // One read of the ids for every root, in the order the tree shows them.
  const roots = reads.flatMap(({ read }) => read.roots);
  const given = await ids.rootsOf(
    roots.map(({ node, ref }) => ({ className: node.className, ref }))
  );
  roots.forEach(({ node }, index) => {
    const id = given[index]?.id;
    if (id) node.id = id;
  });
  return { objects: tree, tree: capture.tree };
}

type MutableNode = {
  -readonly [K in keyof PageObjectTreeNode]: PageObjectTreeNode[K];
};

type Read = {
  driver: Pick<PageDriver, "ariaSnapshot" | "refs">;
  capture: PageStateCapture;
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

async function readNode(
  read: Read,
  instance: PomInstanceObservation,
  manifest: Pick<PomComponentManifest, "members">
): Promise<PageObjectTreeNode> {
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
      const collection = member.collection === true;
      const elements = await elementsOf(read, source.locator);
      if (collection || elements.length > 0)
        children.push({
          kind: "elements",
          name: member.memberName,
          collection,
          elements,
        });
      continue;
    }
    const component = read.components.get(member.componentClassName);
    if (!component) continue;
    const objects: PageObjectTreeNode[] = [];
    for (const child of childInstances(read, path, member.collection === true))
      objects.push(...(await readNodes(read, child, component)));
    if (member.collection)
      children.push({ kind: "objects", name: member.memberName, objects });
    else
      for (const object of objects)
        children.push({ kind: "object", name: member.memberName, object });
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
 * the page while the Page Object it is reached through is not (ADR-0042),
 * and its tools are listed.
 */
async function readNodes(
  read: Read,
  instance: PomInstanceObservation,
  manifest: Pick<PomComponentManifest, "members">
): Promise<PageObjectTreeNode[]> {
  if (instance.present) return [await readNode(read, instance, manifest)];
  const nodes: PageObjectTreeNode[] = [];
  for (const member of manifest.members) {
    if (member.kind === "locator") continue;
    const component = read.components.get(member.componentClassName);
    if (!component) continue;
    const path = join(instance.path, member.memberName);
    for (const child of childInstances(read, path, member.collection === true))
      nodes.push(...(await readNodes(read, child, component)));
  }
  return nodes;
}

/**
 * Each element `locator` resolves to now, by the ref the capture gives it,
 * with its subtree there; an element the capture holds no node of, such as
 * a span of text, by the ref the page names it by, with its aria snapshot.
 * One that is on neither is left out.
 */
async function elementsOf(
  { driver, capture }: Pick<Read, "driver" | "capture">,
  locator: Locator
): Promise<ChildElement[]> {
  const refs = await driver.refs(locator).catch(() => []);
  const elements = await Promise.all(
    refs.map(async (ref, index): Promise<ChildElement> => {
      const named = capturedRef(capture, ref);
      if (named !== undefined)
        return {
          ref: named,
          text: elementText(capture.tree, named),
          captured: true,
        };
      const text = await driver
        .ariaSnapshot(refs.length === 1 ? locator : locator.nth(index))
        .catch(() => "");
      return { ref, text, captured: false };
    })
  );
  return elements.filter(({ text }) => text.trim());
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
