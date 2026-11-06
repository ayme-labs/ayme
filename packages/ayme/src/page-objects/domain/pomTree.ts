import type { Locator } from "@playwright/test";
import type { PomManifest, PomMemberObservation } from "../../shared";
import type { PomInstanceObservation } from "./pomInstance";

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
  /**
   * For an element of a Locator collection, the other locators an
   * Interaction on it names: `last()` for the last element, and the
   * collection's own locator for the one element of a collection that holds
   * one.
   */
  aliases?: readonly string[];
};

/**
 * A target as the registry resolves it: the element named by its Structural
 * Ref, which the browser runtime turns into the `RegisteredPomTarget`'s
 * element.
 */
export type RegisteredPomTargetRef = Omit<RegisteredPomTarget, "element"> & {
  ref: string;
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
  /**
   * Whether the member is declared a Locator collection: each element it
   * holds is a target of its own, at the path with its index, e.g.
   * "RunsTable.rows[1]".
   */
  collection?: boolean;
};

/** Package-internal: what one observation of a registered Page Object found. */
export type PageObjectObservation = {
  /** Every instance the walk found, parents before their members. */
  instances: PomInstanceObservation[];
  memberObservations: PomMemberObservation[];
  /**
   * The locators its members and roots hold, one per concrete member path,
   * in declaration order. Paths through collections carry their item
   * indices; a Locator collection's elements take theirs when resolved.
   */
  targetSources: PomTargetSource[];
  /** The paths of the locator members that resolved to their root. */
  rootMemberPaths: Set<string>;
};

/**
 * Package-internal: the path of the target that is the Page Object Root of
 * the instance at `path`, e.g. "ListPage.items[0].@root". The segment is one
 * no member is named, so a member named `root` never shares a path with it.
 */
export function rootTargetPath(path: string) {
  return `${path}.@root`;
}

/** Package-internal: the classes `manifest` reaches below its own, by name. */
export function componentsOf(manifest: PomManifest) {
  return new Map(
    manifest.components.map((component) => [component.className, component])
  );
}
