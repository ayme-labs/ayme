import type {
  ObjectAction,
  ObjectMember,
  PageObjectModel,
  PageObjectNode,
} from "./pageModel";

// Hand-written page models for unit tests: every Page Object on the page,
// with its locators and its children as members, as buildPageModel makes them.

/**
 * What a Page Object holds: its locators by name, its children, and its
 * actions, which run its tools by the path without item indices, e.g.
 * TodoPage.items.archive. It is on the page unless it says not, and so are
 * its locators.
 */
export type Contents = {
  locators?: readonly string[];
  children?: readonly Child[];
  actions?: readonly Action[];
  live?: boolean;
};

/** An action: its signature is "()" unless it says otherwise. */
export type Action = Pick<ObjectAction, "name"> &
  Partial<Pick<ObjectAction, "description" | "signature">>;

/** A child Page Object or collection, built at its parent's path. */
export type Child = (parentPath: string) => PageObjectNode;

/** A page Page Object, at its class name. */
export function page(className: string, contents: Contents = {}) {
  return objectNode(className, className, "page", className, contents);
}

/** A child Page Object, at `name` under its parent. */
export function component(
  name: string,
  className: string,
  contents: Contents = {}
): Child {
  return (parent) =>
    objectNode(`${parent}.${name}`, name, "component", className, contents);
}

/**
 * A collection under its parent, its items in order, and the tools of the
 * actions that run on one of its items: without them, its items' actions.
 */
export function collection(
  name: string,
  className: string,
  items: readonly Contents[],
  toolNames: readonly string[] = []
): Child {
  return (parent) => {
    const path = `${parent}.${name}`;
    const children = items.map((contents, index) =>
      objectNode(`${path}[${index}]`, `[${index}]`, "item", className, contents)
    );
    return {
      path,
      key: path,
      name,
      kind: "collection",
      className,
      live: children.length > 0,
      itemCount: children.length,
      members: children.map(componentMember),
      actions: toolNames.length
        ? toolNames.map((toolName) => ({
            name: toolName,
            signature: "()",
            toolName,
            live: true,
          }))
        : (children[0]?.actions ?? []),
      children,
    };
  };
}

/** A Page Object Model with its members' paths. */
export function model(className: string, members: string[]): PageObjectModel {
  return {
    className,
    members: members.map((name) => ({
      name,
      kind: "locator",
      path: `${className}.${name}`,
    })),
    actions: [],
    instancePaths: [],
  };
}

function objectNode(
  path: string,
  name: string,
  kind: PageObjectNode["kind"],
  className: string,
  { locators = [], children = [], actions = [], live = true }: Contents
): PageObjectNode {
  const built = children.map((child) => child(path));
  const toolPath = path.replace(/\[\d+\]/g, "");
  return {
    path,
    key: path,
    name,
    kind,
    className,
    live,
    members: [
      ...locators.map((locator): ObjectMember => ({
        name: locator,
        kind: "locator",
        live,
        state: live ? "1 match" : "absent",
        path: `${path}.${locator}`,
      })),
      ...built.map(componentMember),
    ],
    actions: actions.map((action) => ({
      signature: "()",
      ...action,
      toolName: `${toolPath}.${action.name}`,
      live,
    })),
    children: built,
  };
}

function componentMember(node: PageObjectNode): ObjectMember {
  return {
    name: node.name,
    kind: "component",
    className: node.className,
    ...(node.kind === "collection" ? { collection: true } : {}),
    live: node.live,
    state:
      node.kind === "collection"
        ? `${node.itemCount} ${node.itemCount === 1 ? "item" : "items"}`
        : node.live
          ? "on page"
          : "not on page",
    path: node.path,
    objectPath: node.path,
  };
}
