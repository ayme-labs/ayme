import type { Locator } from "@playwright/test";
import type { PomComponentManifest, PomManifest } from "../../shared";
import type { PomInstanceObservation } from "../domain/pomInstance";
import { componentsOf, type PomTargetSource } from "../domain/pomTree";
import {
  elementLines,
  type PageObjectTreeChild,
  type PageObjectTreeNode,
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
 * nest, one with a root with its Page Object id, and each declared element
 * child as its elements' aria snapshots, read now. Ids are given in the
 * order the tree shows the roots.
 */
export async function readPageObjectTree(
  driver: Pick<PageDriver, "ariaSnapshot" | "refs">,
  registrations: readonly TreeRegistration[],
  ids: PageObjectIds
): Promise<PageObjectTreeNode[]> {
  const reads = registrations.flatMap((registration) => {
    const instances = new Map(
      (registration.instances ?? []).map((instance) => [
        instance.path,
        instance,
      ])
    );
    const page = instances.get("");
    if (!page?.present) return [];
    const read: Read = {
      driver,
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
    tree.push(await readNode(read, page, manifest));
  // One read of the ids for every root, in the order the tree shows them.
  const roots = reads.flatMap(({ read }) => read.roots);
  const given = await ids.rootsOf(roots.map(({ ref }) => ref));
  roots.forEach(({ node }, index) => {
    const id = given[index]?.id;
    if (id) node.id = id;
  });
  return tree;
}

type MutableNode = {
  -readonly [K in keyof PageObjectTreeNode]: PageObjectTreeNode[K];
};

type Read = {
  driver: Pick<PageDriver, "ariaSnapshot" | "refs">;
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
      const lines = elementLines(
        await snapshots(read.driver, source.locator),
        member.collection === true
      );
      if (lines)
        children.push({ kind: "elements", name: member.memberName, lines });
      continue;
    }
    const component = read.components.get(member.componentClassName);
    if (!component) continue;
    if (!member.collection) {
      const child = read.instances.get(path);
      if (child?.present)
        children.push({
          kind: "object",
          name: member.memberName,
          object: await readNode(read, child, component),
        });
      continue;
    }
    const objects: PageObjectTreeNode[] = [];
    for (
      let index = 0, child = read.instances.get(`${path}[0]`);
      child;
      child = read.instances.get(`${path}[${++index}]`)
    )
      if (child.present) objects.push(await readNode(read, child, component));
    children.push({ kind: "objects", name: member.memberName, objects });
  }
  return node;
}

/** The aria snapshot of each element `locator` holds now; "" for one it cannot read. */
async function snapshots(
  driver: Pick<PageDriver, "ariaSnapshot" | "refs">,
  locator: Locator
): Promise<string[]> {
  const count = (await driver.refs(locator).catch(() => [])).length;
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      driver
        .ariaSnapshot(count === 1 ? locator : locator.nth(index))
        .catch(() => "")
    )
  );
}
