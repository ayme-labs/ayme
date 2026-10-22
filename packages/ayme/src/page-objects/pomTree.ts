import type { Locator } from "@playwright/test";
import type {
  PomComponentManifest,
  PomComponentMemberManifest,
  PomManifest,
  PomMemberManifest,
  PomMemberObservation,
} from "../shared";
import type { PomInstanceObservation } from "./pomInstance";

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

/**
 * A locator a Page Object member or root holds, at the target path of that
 * member or root. Resolved when the targets are read, so they are the
 * elements it holds then.
 */
export type PomTargetSource = {
  path: string;
  locator: Locator;
  /**
   * For a member of an instance with a root, that root's locator: the
   * member holds no targets while it resolves to the root's one element,
   * since it is the root.
   */
  root?: Locator;
};

/** Package-internal: what one observation of a registered Page Object found. */
export type PageObjectObservation = {
  /** Every instance the walk found, parents before their members. */
  instances: PomInstanceObservation[];
  memberObservations: PomMemberObservation[];
  /**
   * The locators its members and roots hold, one per concrete member path,
   * in declaration order. Paths through collections carry their item
   * indices.
   */
  targetSources: PomTargetSource[];
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
 * would repeat it forever. Its instances there belong to its first
 * occurrence, which `observePageObject` follows.
 */
export function pomGroups(manifest: PomManifest): PomGroup[] {
  const components = componentsOf(manifest);
  const groups: PomGroup[] = [];
  const visit = (
    members: readonly PomMemberManifest[],
    path: readonly PomComponentMemberManifest[],
    occurrences: Occurrences
  ) => {
    for (const member of members) {
      if (member.kind !== "component") continue;
      const component = components.get(member.componentClassName);
      if (!component) continue;
      const memberPath = [...path, member];
      const key = componentKey(memberPath);
      const { repeatOf, below } = occurrenceOf(
        occurrences,
        component.className,
        key
      );
      if (repeatOf !== undefined) continue;
      const itemDepth = memberPath
        .map((step) => step.collection)
        .lastIndexOf(true);
      groups.push({
        component,
        key,
        toolPath: memberPath.map((step) => step.memberName).join("."),
        ...(itemDepth < 0
          ? {}
          : {
              collectionKey: componentKey(memberPath.slice(0, itemDepth + 1)),
            }),
      });
      visit(component.members, memberPath, below);
    }
  };
  visit(manifest.members, [], new Map());
  return groups;
}

/**
 * The classes on a path through the tree, each with the key of its first
 * occurrence there.
 */
export type Occurrences = ReadonlyMap<string, string>;

/**
 * Where the class `className` at `key` belongs on a path with
 * `occurrences`: a class that already appears higher on it belongs to its
 * first occurrence, `repeatOf`. `below` is what the path holds under it.
 */
export function occurrenceOf(
  occurrences: Occurrences,
  className: string,
  key: string
): { repeatOf: string | undefined; below: Occurrences } {
  const first = occurrences.get(className);
  return first === undefined
    ? { repeatOf: undefined, below: new Map(occurrences).set(className, key) }
    : { repeatOf: first, below: occurrences };
}

function componentKey(path: readonly PomComponentMemberManifest[]) {
  return path
    .map((member) => `${member.memberName}${member.collection ? "[]" : ""}`)
    .join(".");
}

/** Package-internal: the classes `manifest` reaches below its own, by name. */
export function componentsOf(manifest: PomManifest) {
  return new Map(
    manifest.components.map((component) => [component.className, component])
  );
}
