import type { Locator } from "@playwright/test";
import type { PomComponentManifest, PomManifest } from "../../shared";
import type { PomInstanceObservation } from "../domain/pomInstance";
import { componentsOf, type PomTargetSource } from "../domain/pomTree";
import {
  elementLines,
  type ScreenChild,
  type ScreenObject,
} from "../domain/pomScreenText";
import type { PageDriver } from "./pageDriver";

/** A registered Page Object as its last observation found it. */
export type ScreenRegistration = {
  manifest: PomManifest;
  instances: readonly PomInstanceObservation[] | undefined;
  targetSources: readonly PomTargetSource[];
  rootMemberPaths: ReadonlySet<string>;
};

const INSTANCE_REF = /^po[1-9]\d*$/;

/** Whether `ref` is written as an Instance Ref, `po<n>`. */
export const isInstanceRef = (ref: string) => INSTANCE_REF.test(ref);

/**
 * The Instance Refs of one page's Page Object instances: `po<n>`, minted in
 * the order the screen first shows an instance and kept, by the element of
 * its root, while that element stays on the page. A ref is never given to
 * another instance.
 */
export function createInstanceRefs(driver: PageDriver) {
  // Each minted ref and the Structural Ref its root's element had when last read.
  const roots = new Map<string, string>();
  let minted = 0;

  /** The Structural Refs of `rootRefs`' elements now, after dropping the gone. */
  async function current(): Promise<Map<string, string>> {
    const minted = [...roots];
    const now = await driver.currentRefs(minted.map(([, ref]) => ref));
    minted.forEach(([instanceRef], index) => {
      const ref = now[index];
      if (ref) roots.set(instanceRef, ref);
      else roots.delete(instanceRef);
    });
    return new Map([...roots].map(([instanceRef, ref]) => [ref, instanceRef]));
  }

  return {
    /** The Instance Ref of each root, by its Structural Ref, minting new ones. */
    async refsOf(rootRefs: readonly string[]): Promise<(string | undefined)[]> {
      const byRoot = await current();
      const now = await driver.currentRefs(rootRefs);
      return now.map((ref) => {
        if (!ref) return undefined;
        let instanceRef = byRoot.get(ref);
        if (!instanceRef) {
          instanceRef = `po${++minted}`;
          roots.set(instanceRef, ref);
          byRoot.set(ref, instanceRef);
        }
        return instanceRef;
      });
    },
    /** The Structural Ref the root `instanceRef` names has now, if still on the page. */
    async rootOf(instanceRef: string): Promise<string | undefined> {
      if (!roots.has(instanceRef)) return undefined;
      await current();
      return roots.get(instanceRef);
    },
  };
}

export type InstanceRefs = ReturnType<typeof createInstanceRefs>;

/**
 * Package-internal: the Page Object Screen of `registrations`, as their last
 * observation found them: each present instance, nested as the models nest,
 * an instance of a class in `rootedClasses` with its Instance Ref, and each
 * declared locator child as its elements' aria snapshots.
 */
export async function readPomScreen(
  driver: PageDriver,
  registrations: readonly ScreenRegistration[],
  rootedClasses: ReadonlySet<string>,
  instanceRefs: InstanceRefs
): Promise<ScreenObject[]> {
  const screen: ScreenObject[] = [];
  for (const registration of registrations) {
    const instances = new Map(
      (registration.instances ?? []).map((instance) => [
        instance.path,
        instance,
      ])
    );
    const page = instances.get("");
    if (!page?.present) continue;
    const read: Read = {
      driver,
      label: registration.manifest.className,
      components: componentsOf(registration.manifest),
      instances,
      sources: new Map(
        registration.targetSources.map((source) => [source.path, source])
      ),
      rootMemberPaths: registration.rootMemberPaths,
      rootedClasses,
      instanceRefs,
    };
    screen.push(await readObject(read, page, registration.manifest));
  }
  return screen;
}

type Read = {
  driver: PageDriver;
  label: string;
  components: ReadonlyMap<string, PomComponentManifest>;
  instances: ReadonlyMap<string, PomInstanceObservation>;
  sources: ReadonlyMap<string, PomTargetSource>;
  rootMemberPaths: ReadonlySet<string>;
  rootedClasses: ReadonlySet<string>;
  instanceRefs: InstanceRefs;
};

const join = (prefix: string, name: string) =>
  prefix ? `${prefix}.${name}` : name;

async function readObject(
  read: Read,
  instance: PomInstanceObservation,
  manifest: Pick<PomComponentManifest, "className" | "members">
): Promise<ScreenObject> {
  // Minted before its children's, so refs follow the screen's order.
  const rootRef = instance.root?.ref;
  const ref =
    rootRef && read.rootedClasses.has(instance.className)
      ? (await read.instanceRefs.refsOf([rootRef]))[0]
      : undefined;
  const children: ScreenChild[] = [];
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
          object: await readObject(read, child, component),
        });
      continue;
    }
    const objects: ScreenObject[] = [];
    for (
      let index = 0, child = read.instances.get(`${path}[0]`);
      child;
      child = read.instances.get(`${path}[${++index}]`)
    )
      if (child.present) objects.push(await readObject(read, child, component));
    children.push({ kind: "objects", name: member.memberName, objects });
  }
  return {
    className: instance.className,
    ...(ref ? { ref } : {}),
    children,
  };
}

/** The aria snapshot of each element `locator` holds now; none it cannot read. */
async function snapshots(
  driver: PageDriver,
  locator: Locator
): Promise<string[]> {
  const count = (await driver.refs(locator).catch(() => [])).length;
  const read = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      driver
        .ariaSnapshot(count === 1 ? locator : locator.nth(index))
        .catch(() => "")
    )
  );
  return read;
}
