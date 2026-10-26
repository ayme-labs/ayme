import type { Locator } from "@playwright/test";
import type {
  PomComponentManifest,
  PomComponentMemberManifest,
  PomManifest,
  PomMemberManifest,
  PomMemberObservation,
  ToolManifest,
} from "../../shared";
import { instanceLabel } from "../domain/observationReport";
import { modelOption } from "../domain/decorators";
import { errorText, RuntimeStateError } from "../../shared";
import {
  absentPomRoot,
  type ObservedPomRoot,
  type PomInstanceObservation,
} from "../domain/pomInstance";
import { askPredicates, askPresence } from "./pomPredicates";
import type { PageDriver } from "./pageDriver";
import {
  componentsOf,
  rootTargetPath,
  type PageObjectObservation,
  type PomTargetSource,
  type RegisteredPomTarget,
} from "../domain/pomTree";

/**
 * Package-internal: the elements `sources` hold now, in their order. A
 * locator that cannot be resolved holds none; its observation says why.
 */
export function resolveTargets(
  driver: PageDriver,
  sources: readonly PomTargetSource[]
): RegisteredPomTarget[] {
  // Each locator once: a member's root is also a source of its own.
  const resolved = new Map<Locator, Element[]>();
  const elementsOf = (locator: Locator) => {
    let elements = resolved.get(locator);
    if (!elements) {
      try {
        elements = driver.elementsOf(locator);
      } catch {
        elements = [];
      }
      resolved.set(locator, elements);
    }
    return elements;
  };
  return sources.flatMap(({ path, locator, root }) => {
    const elements = elementsOf(locator);
    if (root && isRootElement(elements, elementsOf(root))) return [];
    const name = locator.toString();
    return elements.map((element) => ({ path, element, locator: name }));
  });
}

/**
 * Package-internal: observes the registered Page Object `instance` of
 * `manifest` once, reading the page through `driver`: its instances, its
 * members, and the elements they hold. It reads the page and the Page
 * Objects only; what to log is the caller's.
 */
export async function observePageObject(
  driver: PageDriver,
  instance: object,
  manifest: PomManifest
): Promise<PageObjectObservation> {
  const walk: Walk = {
    driver,
    label: manifest.className,
    components: componentsOf(manifest),
    instances: [],
    memberObservations: [],
    targetSources: [],
    rootMemberPaths: new Set(),
  };
  const place: Place = {
    path: "",
    className: manifest.className,
    present: true,
  };
  const page = await observeInstance(walk, instance, manifest.tools, {
    ...place,
    page: true,
  });
  if (page.walk)
    await walkMembers(
      walk,
      instance,
      manifest.members,
      {
        ...place,
        present: page.observed.present,
        rootElement: page.observed.root?.element,
        rootLocator: page.observed.rootLocator,
      },
      new Set()
    );
  return {
    instances: walk.instances,
    memberObservations: walk.memberObservations,
    targetSources: walk.targetSources,
    rootMemberPaths: walk.rootMemberPaths,
  };
}

/** One walk over a registered Page Object's tree, and what it found. */
type Walk = PageObjectObservation & {
  driver: PageDriver;
  /** The registered Page Object's name, which its targets' paths start with. */
  label: string;
  components: ReadonlyMap<string, PomComponentManifest>;
};

/** Where in the walk an instance's members are. */
type Place = Pick<PomInstanceObservation, "path" | "className"> & {
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
  /** The instance's root locator, which its member targets are read against. */
  rootLocator?: Locator;
};

/**
 * Where an instance is observed: the registered Page Object itself, a
 * single child, or a collection item. `present` is the presence a root-less
 * one with no predicate takes.
 */
type InstancePlace = Omit<Place, "rootElement" | "rootLocator"> & {
  page: boolean;
};

/** What observing one instance found, and whether to walk its members. */
type ObservedInstance = {
  observed: PomInstanceObservation;
  walk: boolean;
};

/**
 * Observes `instance` at `place`, records it in `walk`, and says whether its
 * members are walked. Its presence predicate is asked before its root is
 * read or any member is: an instance it withdraws costs one call, and its
 * members are not walked. It is present then while its root is, a root-less
 * one with a predicate by the predicate alone, and a root-less one with
 * neither as `place` says. A child whose root cannot be read is absent and
 * not walked, and the observation says why; the registered Page Object
 * itself is walked anyway. A child absent by its root is still walked:
 * a present Page Object inside one that is not on the page stays listed
 * (ADR-0020).
 */
async function observeInstance(
  walk: Walk,
  instance: object,
  tools: readonly ToolManifest[],
  { page, ...place }: InstancePlace
): Promise<ObservedInstance> {
  const observed: PomInstanceObservation = {
    path: place.path,
    instance,
    className: place.className,
    present: false,
    root: undefined,
    predicates: new Map(),
  };
  const presence = await askPresence(instance);
  if (presence.present === false) {
    observed.presenceError = presence.error;
    walk.instances.push(observed);
    return { observed, walk: false };
  }
  const root = await observeRoot(walk.driver, instance);
  if (root) {
    observed.root = root.root;
    observed.rootLocator = root.locator;
    observed.rootCount = root.count;
    if (root.locator)
      walk.targetSources.push({
        path: rootTargetPath(
          place.path ? `${walk.label}.${place.path}` : walk.label
        ),
        locator: root.locator,
      });
    if (!root.locator) {
      const label = instanceLabel(place.className, walk.label, place.path);
      walk.memberObservations.push(
        rootObservation(
          place.path,
          root.error === undefined
            ? `${label}: its root is not a browser locator.`
            : `${label}: its root predicate threw ${root.error}.`
        )
      );
      walk.instances.push(observed);
      return { observed, walk: page };
    }
    if (!page) {
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
  // A root a click would not reach decides availability before any
  // predicate does, so its predicates are not asked: behind a layer each read
  // can wait out the action timeout, for an answer nobody uses (#962).
  if (observed.present && observed.root?.available !== false)
    observed.predicates = await askPredicates(instance, tools);
  walk.instances.push(observed);
  return {
    observed,
    walk: true,
  };
}

/** An instance's root observation that says why it is absent. */
function rootObservation(path: string, error: string): PomMemberObservation {
  return {
    memberName: path ? `${path}.root` : "root",
    kind: "component-root",
    count: 0,
    error,
    diagnostic: true,
  };
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
    let diagnostic = false;
    try {
      const value = await readMember(instance, member);
      if (member.kind === "locator") {
        if (!walk.driver.isLocator(value)) {
          diagnostic = true;
          throw new RuntimeStateError(
            `its ${member.memberName} is not a browser locator.`
          );
        }
        // Kept even while it is the root: it may not be on a later read.
        walk.targetSources.push({
          path: joinPath(walk.label, memberPath),
          locator: value,
          root: place.rootLocator,
        });
        if (resolvesToRoot(walk.driver, value, place.rootElement)) {
          walk.rootMemberPaths.add(memberPath);
          continue;
        }
        walk.memberObservations.push({
          memberName: memberPath,
          kind: "locator",
          access: member.access,
          count: await value.count(),
        });
      } else
        await walkComponentMember(walk, value, member, place, nextAncestors);
    } catch (error) {
      walk.memberObservations.push(
        failedObservation(
          member,
          memberPath,
          `${instanceLabel(place.className, walk.label, place.path)}: ${errorMessage(error)}`,
          diagnostic
        )
      );
    }
  }
}

/**
 * Whether `locator` resolves to `rootElement` alone, so the member holding
 * it is the Page Object Root. By element, not by Locator identity: a getter
 * may build a fresh Locator on each read.
 */
function resolvesToRoot(
  driver: PageDriver,
  locator: Locator,
  rootElement: Element | undefined
) {
  return (
    rootElement !== undefined &&
    isRootElement(driver.elementsOf(locator), [rootElement])
  );
}

/** Whether `elements` is the one element a root holds, `rootElements`. */
function isRootElement(
  elements: readonly Element[],
  rootElements: readonly Element[]
) {
  return (
    rootElements.length === 1 &&
    elements.length === 1 &&
    elements[0] === rootElements[0]
  );
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
        rootObservation(
          path,
          `${instanceLabel(manifest.className, walk.label, path)}: it is not an object.`
        )
      );
      continue;
    }
    const child = await observeInstance(walk, component, manifest.tools, {
      page: false,
      path,
      className: manifest.className,
      present: place.present,
    });
    const { observed } = child;
    if (!child.walk) continue;
    await walkMembers(
      walk,
      component,
      manifest.members,
      {
        path,
        className: observed.className,
        present: observed.present,
        rootElement: observed.root?.element,
        rootLocator: observed.rootLocator,
      },
      ancestors
    );
  }
}

function failedObservation(
  member: PomMemberManifest,
  memberPath: string,
  error: string,
  diagnostic: boolean
): PomMemberObservation {
  return {
    diagnostic,
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
    error,
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
  driver: PageDriver,
  instance: object
): Promise<RootObservation | undefined> {
  // A rootless Page Object with no predicate is on every page.
  if (!modelOption(instance.constructor, "root")) return undefined;
  let locator: Locator | undefined;
  try {
    locator = await readRoot(driver, instance);
  } catch (error) {
    return { root: absentPomRoot, count: 0, error: errorText(error) };
  }
  if (!locator) return { root: absentPomRoot, count: 0 };
  return { ...(await driver.observeRoot(locator)), locator };
}

/**
 * The locator that anchors `instance`, its Page Object Root: what the `root`
 * option its class declares or inherits answers. Undefined without the
 * option, or when the answer is not a locator; a root predicate that throws,
 * throws.
 */
async function readRoot(
  driver: PageDriver,
  instance: object
): Promise<Locator | undefined> {
  const predicate = modelOption(instance.constructor, "root");
  if (!predicate) return undefined;
  const root = await predicate(instance as never);
  return driver.isLocator(root) ? root : undefined;
}

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
