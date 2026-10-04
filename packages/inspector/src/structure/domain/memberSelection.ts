import type { StructureTree } from "./structure";

/**
 * Whether a member still resolves on the page: some node of the structure is
 * that member, one of its items, or inside it.
 *
 * @param within the paths of the member and of everything inside it.
 */
export function memberResolves(
  structure: StructureTree,
  within: ReadonlySet<string>
) {
  const visit = (nodes: StructureTree["roots"]): boolean =>
    nodes.some(
      (node) =>
        node.members.some((member) => within.has(member)) ||
        visit(node.children)
    );
  return visit(structure.roots);
}

/** What a run says about where it acted, for scoping it to a member. */
export type RunPlace = {
  /** The Page Object it ran on, e.g. "ListPage.items[1]". */
  objectPath?: string;
  /** The members its steps acted on, e.g. "ListPage.addItemButton". */
  stepMembers?: readonly (string | undefined)[];
};

/**
 * Whether a run belongs to a member selection: it ran on the member (or on
 * one of a collection member's items), or one of its steps targeted the
 * member.
 *
 * @param within the paths of the member and of everything inside it.
 */
export function runIsOnMember(within: ReadonlySet<string>, run: RunPlace) {
  const inside = (path: string | undefined) =>
    path !== undefined && within.has(path);
  return inside(run.objectPath) || (run.stepMembers ?? []).some(inside);
}
