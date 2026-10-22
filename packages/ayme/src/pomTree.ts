import type { Locator } from "@playwright/test";
import {
  isPlaywrightLiteLocator,
  resolveLocatorElements,
} from "@ayme-dev/playwright-lite/internal";
import type {
  PomComponentManifest,
  PomComponentMemberManifest,
  PomManifest,
  PomMemberManifest,
  PomMemberObservation,
  ToolManifest,
} from "./contracts";
import { modelOption } from "./decorators";
import { errorText, RuntimeStateError } from "./errors";
import {
  askPredicates,
  askPresence,
  type PomInstanceObservation,
} from "./pomInstance";
import { observePomRoot, type ObservedPomRoot } from "./pomRootObservation";

/**
 * Package-internal: a place in a Page Object's tree where component tools
 * live: one per component member path the tools reach, e.g. "items[].details".
 */
export type PomGroup = {
  component: PomComponentManifest;
  /**
   * Its path without item indices, e.g. "items[].details": the component
   * path of its tools and of the instances they act on.
   */
  key: string;
  /** Its path as tool names spell it, e.g. "items.details". */
  toolPath: string;
  /**
   * For a group that goes through a collection, the key of the items a ref
   * names, e.g. "items[]" for "items[].details".
   */
  collectionKey?: string;
};

/**
 * An element a Page Object member holds, at the member's concrete path, e.g.
 * "ListPage.items[0].nameButton", or at `rootTargetPath` of a Page Object's
 * path for its root.
 */
export type RegisteredPomTarget = {
  path: string;
  element: Element;
  /**
   * The member's locator, as its `toString()` reads, e.g.
   * "getByRole('button', { name: 'Add item' })": the locator an Interaction
   * on the member names.
   */
  locator: string;
};

/** Package-internal: what one observation of a registered Page Object found. */
export type PageObjectObservation = {
  /** Every instance the walk found, parents before their members. */
  instances: PomInstanceObservation[];
  memberObservations: PomMemberObservation[];
  /**
   * The elements its members and roots hold, one target per element and
   * concrete member path, in declaration order. Paths through collections
   * carry their item indices.
   */
  targets: RegisteredPomTarget[];
  /** The paths of the locator members that resolved to their root. */
  rootMemberPaths: Set<string>;
  /**
   * The collections holding an item that declares no root, by path, e.g.
   * "owners" or "items[1].tags", with the item's class name.
   */
  rootlessCollections: Map<string, string>;
};

/**
 * Package-internal: the path of the target that is the Page Object Root of
 * the instance at `path`, e.g. "ListPage.items[0].@root". The segment is one
 * no member is named, so a member named `root` never shares a path with it.
 */
export function rootTargetPath(path: string) {
  return `${path}.@root`;
}

/**
 * Package-internal: the places `manifest`'s component tools live, a group's
 * own before the ones nested in it, in declaration order. A class that
 * already appears higher on a path ends that path: the manifest alone
 * would repeat it forever.
 */
export function pomGroups(manifest: PomManifest): PomGroup[] {
  const components = componentsOf(manifest);
  const groups: PomGroup[] = [];
  const visit = (
    members: readonly PomMemberManifest[],
    path: readonly PomComponentMemberManifest[],
    classes: ReadonlySet<string>
  ) => {
    for (const member of members) {
      if (member.kind !== "component") continue;
      const component = components.get(member.componentClassName);
      if (!component || classes.has(component.className)) continue;
      const memberPath = [...path, member];
      const itemDepth = memberPath
        .map((step) => step.collection)
        .lastIndexOf(true);
      groups.push({
        component,
        key: componentKey(memberPath),
        toolPath: memberPath.map((step) => step.memberName).join("."),
        ...(itemDepth < 0
          ? {}
          : {
              collectionKey: componentKey(memberPath.slice(0, itemDepth + 1)),
            }),
      });
      visit(
        component.members,
        memberPath,
        new Set(classes).add(component.className)
      );
    }
  };
  visit(manifest.members, [], new Set());
  return groups;
}

function componentKey(path: readonly PomComponentMemberManifest[]) {
  return path
    .map((member) => `${member.memberName}${member.collection ? "[]" : ""}`)
    .join(".");
}

/**
 * Package-internal: observes the registered Page Object `instance` of
 * `manifest` once: its instances, its members, and the elements they hold.
 * It reads the page and the Page Objects only; what to log is the caller's.
 */
export async function observePageObject(
  instance: object,
  manifest: PomManifest
): Promise<PageObjectObservation> {
  const walk: Walk = {
    label: manifest.className,
    components: componentsOf(manifest),
    instances: [],
    memberObservations: [],
    targets: [],
    rootMemberPaths: new Set(),
    rootlessCollections: new Map(),
  };
  const place: Place = {
    path: "",
    componentPath: "",
    item: undefined,
    present: true,
  };
  const page = await observeInstance(walk, instance, manifest.tools, {
    ...place,
    kind: "page",
  });
  if (page.kind === "observed" && page.walk)
    await walkMembers(
      walk,
      instance,
      manifest.members,
      {
        ...place,
        present: page.observed.present,
        rootElement: page.rootElement,
      },
      new Set()
    );
  return {
    instances: walk.instances,
    memberObservations: walk.memberObservations,
    targets: walk.targets,
    rootMemberPaths: walk.rootMemberPaths,
    rootlessCollections: walk.rootlessCollections,
  };
}

function componentsOf(manifest: PomManifest) {
  return new Map(
    manifest.components.map((component) => [component.className, component])
  );
}

/** One walk over a registered Page Object's tree, and what it found. */
type Walk = PageObjectObservation & {
  /** The registered Page Object's name, which its targets' paths start with. */
  label: string;
  components: ReadonlyMap<string, PomComponentManifest>;
};

/** Where in the walk an instance's members are. */
type Place = Pick<PomInstanceObservation, "path" | "item"> & {
  componentPath: string;
  /**
   * Whether the instance is present: what a root-less single child with no
   * predicate follows.
   */
  present: boolean;
  /**
   * The one element the instance's root locator resolved to, when it did: a
   * locator member resolving to that element alone is the root, not a child.
   */
  rootElement?: Element;
};

/**
 * Where an instance is observed: the registered Page Object itself, a
 * single child, or a collection item. `present` is the presence a root-less
 * one with no predicate takes.
 */
type InstancePlace = Omit<Place, "rootElement"> & {
  kind: "page" | "child" | "item";
};

/** What observing one instance found, and whether to walk its members. */
type ObservedInstance =
  | { kind: "rootless" }
  | {
      kind: "observed";
      observed: PomInstanceObservation;
      walk: boolean;
      rootElement?: Element;
    };

/**
 * Observes `instance` at `place`, records it in `walk`, and says whether its
 * members are walked. Its presence predicate is asked before its root is
 * read or any member is: an instance it withdraws costs one call, and its
 * members are not walked. It is present then while its root is, a root-less
 * one with a predicate by the predicate alone, and a root-less one with
 * neither as `place` says. A child whose root cannot be read is absent and
 * not walked, and the observation says why; the registered Page Object
 * itself is walked anyway. A collection item needs a root for its ref, which
 * the build refuses when every options object in the chain is an inline
 * literal naming no root; anything else is recorded here, at observation,
 * and the item is not observed. A child absent by its root is still walked:
 * a present Page Object inside one that is not on the page stays listed
 * (ADR-0020).
 */
async function observeInstance(
  walk: Walk,
  instance: object,
  tools: readonly ToolManifest[],
  { kind, ...place }: InstancePlace
): Promise<ObservedInstance> {
  const observed: PomInstanceObservation = {
    path: place.path,
    instance,
    componentPath: kind === "page" ? undefined : place.componentPath,
    item: place.item,
    present: false,
    root: undefined,
    predicates: new Map(),
  };
  if (kind === "item") observed.item = observed;
  const presence = await askPresence(instance);
  if (presence.present === false) {
    observed.presenceError = presence.error;
    walk.instances.push(observed);
    return { kind: "observed", observed, walk: false };
  }
  const root = await observeRoot(instance);
  if (!root && kind === "item") return { kind: "rootless" };
  if (root) {
    observed.root = root.root;
    observed.rootLocator = root.locator;
    observed.rootError = root.error;
    observed.rootCount = root.count;
    if (root.locator) pushRootTargets(walk, place.path, root.locator);
    if (kind !== "page") {
      if (root.error !== undefined || !root.locator) {
        walk.memberObservations.push(
          rootObservation(
            place.path,
            root.error === undefined
              ? `POM component ${place.path}'s root is not a browser locator.`
              : `POM component ${place.path}'s root could not be read: ${root.error}.`
          )
        );
        walk.instances.push(observed);
        return { kind: "observed", observed, walk: false };
      }
      walk.memberObservations.push({
        memberName: `${place.path}.root`,
        kind: "component-root",
        count: root.count,
      });
    }
  }
  observed.present = root
    ? root.root.present
    : (presence.present ?? place.present);
  if (observed.present)
    observed.predicates = await askPredicates(instance, tools);
  walk.instances.push(observed);
  return {
    kind: "observed",
    observed,
    walk: true,
    rootElement: observed.root?.element,
  };
}

/** A child's root observation that says why the child is absent. */
function rootObservation(path: string, error: string): PomMemberObservation {
  return {
    memberName: `${path}.root`,
    kind: "component-root",
    count: 0,
    error,
  };
}

/**
 * Pushes the elements the root locator of the instance at `path` resolves
 * to as targets at the root target path.
 */
function pushRootTargets(walk: Walk, path: string, root: Locator) {
  const targetPath = rootTargetPath(
    path ? `${walk.label}.${path}` : walk.label
  );
  const locator = root.toString();
  for (const element of locatorElements(root))
    walk.targets.push({ path: targetPath, element, locator });
}

async function walkMembers(
  walk: Walk,
  instance: object,
  members: readonly PomMemberManifest[],
  place: Place,
  ancestors: ReadonlySet<object>
): Promise<void> {
  if (ancestors.has(instance)) return;
  const nextAncestors = new Set(ancestors).add(instance);
  for (const member of members) {
    const memberPath = joinPath(place.path, member.memberName);
    try {
      const value = await readMember(instance, member);
      if (member.kind === "locator") {
        if (isLocator(value) && resolvesToRoot(value, place.rootElement)) {
          walk.rootMemberPaths.add(memberPath);
          continue;
        }
        walk.memberObservations.push(
          await observeLocator(walk, value, member, memberPath)
        );
      } else
        await walkComponentMember(walk, value, member, place, nextAncestors);
    } catch (error) {
      walk.memberObservations.push(
        failedObservation(member, memberPath, error)
      );
    }
  }
}

/**
 * Whether `locator` resolves to `rootElement` alone, so the member holding
 * it is the Page Object Root. By element, not by Locator identity: a getter
 * may build a fresh Locator on each read.
 */
function resolvesToRoot(locator: Locator, rootElement: Element | undefined) {
  if (!rootElement) return false;
  const elements = locatorElements(locator);
  return elements.length === 1 && elements[0] === rootElement;
}

async function observeLocator(
  walk: Walk,
  value: unknown,
  member: PomMemberManifest,
  memberPath: string
): Promise<PomMemberObservation> {
  if (!isLocator(value))
    throw new RuntimeStateError(
      `POM member ${memberPath} is not a browser locator.`
    );
  const observation: PomMemberObservation = {
    memberName: memberPath,
    kind: "locator",
    access: member.access,
    count: await value.count(),
  };
  const path = joinPath(walk.label, memberPath);
  const locator = value.toString();
  for (const element of locatorElements(value))
    walk.targets.push({ path, element, locator });
  return observation;
}

/**
 * Walks the component, or each component of the collection, a member of
 * the instance at `place` holds.
 */
async function walkComponentMember(
  walk: Walk,
  value: unknown,
  member: PomComponentMemberManifest,
  place: Place,
  ancestors: ReadonlySet<object>
) {
  const manifest = walk.components.get(member.componentClassName);
  if (!manifest)
    throw new RuntimeStateError(
      `No metadata found for component ${member.componentClassName}.`
    );
  const memberPath = joinPath(place.path, member.memberName);
  const componentPath = joinPath(
    place.componentPath,
    `${member.memberName}${member.collection ? "[]" : ""}`
  );
  const values = member.collection ? asComponents(value) : [value];
  if (member.collection)
    walk.memberObservations.push({
      memberName: memberPath,
      kind: "component-collection",
      access: member.access,
      count: values.length,
    });
  for (const [index, component] of values.entries()) {
    const path = member.collection ? `${memberPath}[${index}]` : memberPath;
    if (!isRecord(component)) {
      walk.memberObservations.push(
        rootObservation(path, `POM component ${path} is not an object.`)
      );
      continue;
    }
    const child = await observeInstance(walk, component, manifest.tools, {
      kind: member.collection ? "item" : "child",
      path,
      componentPath,
      item: place.item,
      present: place.present,
    });
    if (child.kind === "rootless") {
      walk.memberObservations.push(
        rootObservation(path, `POM component ${path} declares no root.`)
      );
      walk.rootlessCollections.set(memberPath, manifest.className);
      continue;
    }
    if (!child.walk) continue;
    await walkMembers(
      walk,
      component,
      manifest.members,
      {
        path,
        componentPath,
        item: child.observed.item,
        present: child.observed.present,
        rootElement: child.rootElement,
      },
      ancestors
    );
  }
}

function failedObservation(
  member: PomMemberManifest,
  memberPath: string,
  error: unknown
): PomMemberObservation {
  return {
    memberName:
      member.kind === "component" && !member.collection
        ? `${memberPath}.root`
        : memberPath,
    kind:
      member.kind === "locator"
        ? "locator"
        : member.collection
          ? "component-collection"
          : "component-root",
    access: member.access,
    count: 0,
    error: errorMessage(error),
  };
}

/** What observing an instance's declared root found. */
type RootObservation = {
  root: ObservedPomRoot;
  /** How many elements the root locator matched. */
  count: number;
  /** The locator the root predicate answered, when it answered one. */
  locator?: Locator;
  /** What the root predicate threw, when it threw. */
  error?: string;
};

/**
 * Observes `instance`'s declared root. A root the predicate throws on, or
 * answers no locator for, never falls back to rootless activation: it is
 * absent.
 */
async function observeRoot(
  instance: object
): Promise<RootObservation | undefined> {
  // A rootless Page Object with no predicate is on every page.
  if (!modelOption(instance.constructor, "root")) return undefined;
  let locator: Locator | undefined;
  try {
    locator = await readRoot(instance);
  } catch (error) {
    return { root: absentRoot, count: 0, error: errorText(error) };
  }
  if (!locator) return { root: absentRoot, count: 0 };
  return { ...(await observePomRoot(locator)), locator };
}

/**
 * The locator that anchors `instance`, its Page Object Root: what the `root`
 * option its class declares or inherits answers. Undefined without the
 * option, or when the answer is not a locator; a root predicate that throws,
 * throws.
 */
async function readRoot(instance: object): Promise<Locator | undefined> {
  const predicate = modelOption(instance.constructor, "root");
  if (!predicate) return undefined;
  const root = await predicate(instance as never);
  return isLocator(root) ? root : undefined;
}

const absentRoot: ObservedPomRoot = {
  element: undefined,
  present: false,
  available: false,
  inTheWay: [],
};

function joinPath(prefix: string, name: string) {
  return prefix ? `${prefix}.${name}` : name;
}

async function readMember(instance: object, member: PomMemberManifest) {
  const value = Reflect.get(instance, member.memberName);
  if (member.access === "method") {
    if (!isCallable(value))
      throw new RuntimeStateError(
        `POM member ${member.memberName} is not callable.`
      );
    return await value.apply(instance, []);
  }
  return await value;
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

function isLocator(value: unknown): value is Locator {
  return isPlaywrightLiteLocator(value);
}

function locatorElements(locator: Locator): Element[] {
  return resolveLocatorElements(locator);
}

function asComponents(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new RuntimeStateError("Expected a component collection array.");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
