import type { StructureTree } from "../adapter/structure";

/**
 * Whether a member still resolves on the page: some node of the structure is
 * that member, one of its items, or inside it. A member selection that no
 * longer resolves is stale, like any other.
 */
export function memberResolves(structure: StructureTree, path: string) {
  const inside = (member: string) =>
    member === path ||
    member.startsWith(`${path}[`) ||
    member.startsWith(`${path}.`);
  const visit = (nodes: StructureTree["roots"]): boolean =>
    nodes.some((node) => node.members.some(inside) || visit(node.children));
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
 */
export function runIsOnMember(member: string, run: RunPlace) {
  const within = (path: string | undefined) =>
    path !== undefined &&
    (path === member ||
      path.startsWith(`${member}[`) ||
      path.startsWith(`${member}.`));
  return within(run.objectPath) || (run.stepMembers ?? []).some(within);
}
