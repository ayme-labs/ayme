import type { ObjectMember, PageModel, PageObjectNode } from "./pageModel";

/**
 * A Page Object member as the page model has it: a Page Object, which its
 * root element stands for, or a locator member of the Page Object that
 * declares it.
 */
export type IndexedMember = {
  /** Its path, e.g. "ListPage.items[0]" or "ListPage.items[0].nameButton". */
  path: string;
  /**
   * The Page Object it is, or that declares it; the collection itself for a
   * collection's path.
   */
  owner: PageObjectNode;
  /** The locator, when it is one. */
  locator?: ObjectMember;
};

/**
 * The page model indexed by member path, built once per update: what the
 * Inspector reads Page Object structure from, instead of from the paths.
 */
export type MemberIndex = {
  /**
   * The member a registry target is, by the target's path; undefined for one
   * the page model doesn't have (yet), such as an item the probe hasn't
   * reported.
   */
  member(targetPath: string): IndexedMember | undefined;
  /**
   * A node and the nodes it is in, nearest first, up to its page: an item's
   * collection, that collection's Page Object, and so on.
   */
  ancestors(node: PageObjectNode): readonly PageObjectNode[];
  /**
   * The registry target paths of what a path names (see {@link named}): a
   * Page Object's root, a collection's items' roots, a locator's own path.
   */
  targets(path: string): ReadonlySet<string>;
  /**
   * The paths of what a path names and of everything inside it, e.g. a
   * collection, its items and their members.
   */
  within(path: string, options?: NameOptions): ReadonlySet<string>;
  /** The items a collection action runs on, by its tool's name. */
  collectionItems(toolName: string): readonly PageObjectNode[];
};

type NameOptions = {
  /**
   * Whether a Page Object Model's name or one of its members' paths names
   * the group of it on every instance. Defaults to true.
   */
  models?: boolean;
};

/** Indexes the page model, once per update. */
export function indexMembers({ objects, models }: PageModel): MemberIndex {
  const byTarget = new Map<string, IndexedMember>();
  const byPath = new Map<string, IndexedMember>();
  const parents = new Map<PageObjectNode, PageObjectNode>();
  const instances = new Map<string, PageObjectNode[]>();
  const collections: PageObjectNode[] = [];
  const add = (
    index: Map<string, IndexedMember>,
    key: string,
    member: IndexedMember
  ) => {
    // Two registrations of one page class share their paths: the first wins.
    if (!index.has(key)) index.set(key, member);
  };
  const visit = (nodes: readonly PageObjectNode[], parent?: PageObjectNode) => {
    for (const node of nodes) {
      // Stryker disable next-line ConditionalExpression: a page mapped to no parent reads the same as an unmapped one.
      if (parent) parents.set(node, parent);
      const self = { path: node.path, owner: node };
      add(byPath, node.path, self);
      if (node.kind === "collection") collections.push(node);
      else {
        add(byTarget, rootTarget(node), self);
        const ofClass = instances.get(node.className) ?? [];
        ofClass.push(node);
        instances.set(node.className, ofClass);
        for (const locator of node.members)
          if (locator.kind === "locator") {
            const member = { path: locator.path, owner: node, locator };
            add(byTarget, locator.path, member);
            add(byPath, locator.path, member);
          }
      }
      visit(node.children, node);
    }
  };
  visit(objects);
  const modelMembers = new Map(
    models.flatMap(({ className, members }) =>
      members.map(({ path, name }) => [path, { className, name }] as const)
    )
  );

  /**
   * The members a path names: the object or member at that path, and, with
   * `models`, every instance of the model it names, or that member of each.
   * An object or a model member path can be both, e.g. "Header" when a
   * Header page is on the page too.
   */
  const named = (path: string, { models = true }: NameOptions = {}) => {
    const found = byPath.get(path);
    const members = found ? [found] : [];
    if (!models) return members;
    for (const instance of instances.get(path) ?? [])
      members.push({ path: instance.path, owner: instance });
    const modelMember = modelMembers.get(path);
    for (const instance of instances.get(modelMember?.className ?? "") ?? []) {
      const member = instance.members.find(
        ({ name }) => name === modelMember?.name
      );
      const resolved = member && byPath.get(member.objectPath ?? member.path);
      if (resolved) members.push(resolved);
    }
    return members;
  };

  return {
    member: (targetPath) => byTarget.get(targetPath),
    ancestors: (node) => {
      const nodes: PageObjectNode[] = [];
      for (
        let current: PageObjectNode | undefined = node;
        current;
        current = parents.get(current)
      )
        nodes.push(current);
      return nodes;
    },
    targets: (path) =>
      new Set(
        named(path).flatMap(({ owner, locator }) => {
          if (locator) return [locator.path];
          if (owner.kind === "collection")
            return owner.children.map(rootTarget);
          return [rootTarget(owner)];
        })
      ),
    within: (path, options) =>
      new Set(
        named(path, options).flatMap(({ path, owner, locator }) =>
          locator ? [path] : [...subtreePaths(owner)]
        )
      ),
    collectionItems: (toolName) => [
      ...new Map(
        collections
          .filter(({ actions }) =>
            actions.some((action) => action.toolName === toolName)
          )
          .flatMap(({ children }) => children)
          .map((item) => [item.path, item])
      ).values(),
    ],
  };
}

/**
 * A node's path below its page, e.g. "items[1]" for "ListPage.items[1]", or
 * "items[0].tags[1]".
 */
export function pathBelowPage(node: PageObjectNode, index: MemberIndex) {
  return index
    .ancestors(node)
    .filter(({ kind }) => kind !== "page")
    .reverse()
    .reduce(
      (path, { kind, name }) =>
        kind === "item" || !path ? `${path}${name}` : `${path}.${name}`,
      ""
    );
}

/**
 * The registry's target path of a Page Object's root element, the way it
 * names root observations: e.g. "ListPage.items[0].root".
 */
function rootTarget(node: PageObjectNode) {
  return `${node.path}.root`;
}

/** A node's path and its members' and descendants' paths. */
function* subtreePaths(node: PageObjectNode): Generator<string> {
  yield node.path;
  for (const member of node.members) yield member.path;
  for (const child of node.children) yield* subtreePaths(child);
}
