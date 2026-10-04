import type {
  ObjectMember,
  PageObjectModel,
  PageObjectNode,
} from "../domain/pageModel";

// Hand-written page models for unit tests: every Page Object on the page,
// with its locators and its children as members, as buildPageModel makes them.

/** What a Page Object holds: its locators by name, and its children. */
export type Contents = {
  locators?: readonly string[];
  children?: readonly Child[];
};

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
 * actions that run on one of its items.
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
      actions: toolNames.map((toolName) => ({
        name: toolName,
        signature: "()",
        toolName,
        live: true,
      })),
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
  { locators = [], children = [] }: Contents
): PageObjectNode {
  const built = children.map((child) => child(path));
  return {
    path,
    key: path,
    name,
    kind,
    className,
    live: true,
    members: [
      ...locators.map((locator): ObjectMember => ({
        name: locator,
        kind: "locator",
        live: true,
        state: "1 match",
        path: `${path}.${locator}`,
      })),
      ...built.map(componentMember),
    ],
    actions: [],
    children: built,
  };
}

function componentMember(node: PageObjectNode): ObjectMember {
  return {
    name: node.name,
    kind: "component",
    className: node.className,
    ...(node.kind === "collection" ? { collection: true } : {}),
    live: true,
    state: "on page",
    path: node.path,
    objectPath: node.path,
  };
}
