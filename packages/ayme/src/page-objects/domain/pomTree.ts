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
