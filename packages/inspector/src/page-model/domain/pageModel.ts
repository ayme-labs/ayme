import type {
  JsonSchema,
  PomDefinition,
  PomMemberObservation,
} from "@ayme-dev/ayme";
import type {
  PomManifest,
  PomMemberManifest,
  RegisteredPom,
  ToolManifest,
  ToolParameter,
} from "@ayme-dev/ayme/internal";

/**
 * The page model the Model lens shows: the Page Objects on the page as a
 * tree, and the Page Object Models the page knows.
 */
export type PageModel = {
  /** The page Page Objects, each with its tree of children. */
  objects: readonly PageObjectNode[];
  /** The Page Object Models snapshot describes, in its order. */
  models: readonly PageObjectModel[];
};

/**
 * A node of the object tree: a page, a child Page Object, a collection, or
 * one item of a collection.
 */
export type PageObjectNode = {
  /**
   * Its path from the page, e.g. "ListPage.items[1]". Two registrations of
   * one page class share their paths.
   */
  path: string;
  /** What tells it apart from every other node: its registration and path. */
  key: string;
  /** Its name under its parent: "ListPage", "archiveDialog", "items" or "[1]". */
  name: string;
  kind: "page" | "component" | "collection" | "item";
  /** Its Page Object Model; a collection's items' model. */
  className: string;
  /** Whether it is on the page now. A collection is when it has items. */
  live: boolean;
  /** A collection's item count. */
  itemCount?: number;
  members: readonly ObjectMember[];
  /** The actions that run on it. A collection's run on one of its items. */
  actions: readonly ObjectAction[];
  children: readonly PageObjectNode[];
};

/** A member of a Page Object, as found on the page now. */
export type ObjectMember = {
  name: string;
  kind: "locator" | "component";
  /** A child Page Object's model. */
  className?: string;
  collection?: boolean;
  live: boolean;
  /** What the page probe found, e.g. "1 match", "3 items" or "not on page". */
  state: string;
  /**
   * Its path from the page, e.g. "ListPage.newItemInput" or "ListPage.items":
   * what selects and highlights it. A collection lists its items by their
   * paths.
   */
  path: string;
  /** A child Page Object's or collection's path, to go to it. */
  objectPath?: string;
};

export type ObjectAction = {
  name: string;
  description?: string;
  /** Its arguments, e.g. "(text: string)". */
  signature: string;
  /** Its Page Object Tool. */
  toolName: string;
  /**
   * Whether the tool is live: the panel can run it now because its Page
   * Object is on the page. Publication to WebMCP doesn't matter here.
   */
  live: boolean;
};

/** A Page Object Model, as snapshot describes it. */
export type PageObjectModel = {
  className: string;
  description?: string;
  members: readonly ModelMember[];
  actions: readonly ObjectAction[];
  /** The paths of its Page Objects on the page now. */
  instancePaths: readonly string[];
};

export type ModelMember = {
  name: string;
  kind: "locator" | "component";
  className?: string;
  collection?: boolean;
  /**
   * Its path on the model, e.g. "ListItem.nameButton": what selects and
   * highlights it on every instance.
   */
  path: string;
};

/**
 * An action's arguments from its input schema, or from the parameters a
 * manifest records, e.g. "(text: string)".
 */
export type Signature = (
  input: JsonSchema | readonly ToolParameter[]
) => string;

/**
 * Builds the page model from the registered Page Objects, the live tools
 * (the ones the panel can run now), the Page Object Model definitions
 * snapshot returns, and how to write an action's signature.
 */
export function buildPageModel(
  registrations: readonly RegisteredPom[],
  liveToolNames: ReadonlySet<string>,
  definitions: readonly PomDefinition[],
  signature: Signature
): PageModel {
  const objects = registrations.map((registration) =>
    withKeys(
      pageObject(registration, liveToolNames, signature),
      registration.id
    )
  );
  const instances = [...walk(objects)].filter(
    (node) => node.kind !== "collection" && node.live
  );
  const rootMembers = rootMemberPaths(registrations, objects);
  const models = definitions.map((definition): PageObjectModel => ({
    className: definition.name,
    ...(definition.description === undefined
      ? {}
      : { description: definition.description }),
    members: definition.children
      .map((member) => modelMember(definition.name, member))
      .filter((member) => !rootMembers.has(member.path)),
    actions: definition.actions.map((action) => {
      const toolName = `${definition.name}.${action.name}`;
      return {
        name: action.name,
        ...(action.description === undefined
          ? {}
          : { description: action.description }),
        signature: signature(action.inputSchema),
        toolName,
        live: liveToolNames.has(toolName),
      };
    }),
    instancePaths: instances
      .filter((node) => node.className === definition.name)
      .map((node) => node.path),
  }));
  return { objects, models };
}

type UnkeyedNode = Omit<PageObjectNode, "key" | "children"> & {
  children: readonly UnkeyedNode[];
};

function withKeys(node: UnkeyedNode, registrationId: string): PageObjectNode {
  return {
    ...node,
    key: `${registrationId}:${node.path}`,
    children: node.children.map((child) => withKeys(child, registrationId)),
  };
}

/** Every node of the object tree, depth first. */
export function* walk(
  nodes: readonly PageObjectNode[]
): Generator<PageObjectNode> {
  for (const node of nodes) {
    yield node;
    yield* walk(node.children);
  }
}

function pageObject(
  registration: RegisteredPom,
  liveToolNames: ReadonlySet<string>,
  signature: Signature
): UnkeyedNode {
  const { manifest } = registration;
  const context: Context = {
    registration,
    liveToolNames,
    signature,
    components: new Map(
      manifest.components.map((component) => [component.className, component])
    ),
    observations: new Map(
      registration.memberObservations.map((observation) => [
        observation.memberName,
        observation,
      ])
    ),
  };
  return {
    path: manifest.className,
    name: manifest.className,
    kind: "page",
    className: manifest.className,
    live: registration.presentPaths.has(""),
    ...objectParts(context, manifest, ""),
  };
}

type Context = {
  registration: RegisteredPom;
  liveToolNames: ReadonlySet<string>;
  signature: Signature;
  components: ReadonlyMap<string, PomManifest["components"][number]>;
  observations: ReadonlyMap<string, PomMemberObservation>;
};

/**
 * A Page Object's members, actions and children, at a path from its page,
 * e.g. "items[1]", and at its tools' path, which has no item indices, e.g.
 * "items[]".
 */
function objectParts(
  context: Context,
  model: {
    className: string;
    members: readonly PomMemberManifest[];
    tools: readonly ToolManifest[];
  },
  path: string,
  ancestors: ReadonlySet<string> = new Set()
) {
  const members: ObjectMember[] = [];
  const children: UnkeyedNode[] = [];
  const pageName = context.registration.id;
  for (const member of model.members) {
    const memberPath = path
      ? `${path}.${member.memberName}`
      : member.memberName;
    // The member that resolved to the root is the root, not a child.
    if (context.registration.rootMemberPaths.has(memberPath)) continue;
    if (member.kind === "locator") {
      const observation = context.observations.get(memberPath);
      members.push({
        name: member.memberName,
        kind: "locator",
        live: observation !== undefined && isPresent(observation),
        state: locatorState(observation),
        path: `${pageName}.${memberPath}`,
      });
      continue;
    }

    const component = context.components.get(member.componentClassName);
    const nested = new Set(ancestors).add(member.componentClassName);
    const childParts = (childPath: string) =>
      component &&
      (!ancestors.has(member.componentClassName) ||
        context.registration.presentPaths.has(childPath) ||
        context.observations.has(`${childPath}.root`))
        ? objectParts(context, component, childPath, nested)
        : {
            members: [],
            actions: component ? actionsAt(context, component.tools) : [],
            children: [],
          };

    if (member.collection) {
      const count = context.observations.get(memberPath)?.count ?? 0;
      const items = Array.from({ length: count }, (_, index) => {
        const itemPath = `${memberPath}[${index}]`;
        return {
          path: `${pageName}.${itemPath}`,
          name: `[${index}]`,
          kind: "item" as const,
          className: member.componentClassName,
          live: context.registration.presentPaths.has(itemPath),
          ...childParts(itemPath),
        };
      });
      const collection: UnkeyedNode = {
        path: `${pageName}.${memberPath}`,
        name: member.memberName,
        kind: "collection",
        className: member.componentClassName,
        live: count > 0,
        itemCount: count,
        members: items.map((item) => ({
          name: item.name,
          kind: "component",
          className: member.componentClassName,
          live: item.live,
          state: item.live ? "on page" : "not on page",
          path: item.path,
          objectPath: item.path,
        })),
        actions: component ? actionsAt(context, component.tools) : [],
        children: items,
      };
      children.push(collection);
      members.push({
        name: member.memberName,
        kind: "component",
        className: member.componentClassName,
        collection: true,
        live: count > 0,
        state: plural(count, "item", "items"),
        path: collection.path,
        objectPath: collection.path,
      });
      continue;
    }

    const live = context.registration.presentPaths.has(memberPath);
    const child: UnkeyedNode = {
      path: `${pageName}.${memberPath}`,
      name: member.memberName,
      kind: "component",
      className: member.componentClassName,
      live,
      ...childParts(memberPath),
    };
    children.push(child);
    members.push({
      name: member.memberName,
      kind: "component",
      className: member.componentClassName,
      live,
      state: live ? "on page" : "not on page",
      path: child.path,
      objectPath: child.path,
    });
  }

  return {
    members,
    actions: actionsAt(context, model.tools),
    children,
  };
}

/** The actions of a model at one place on the page, with their tools. */
function actionsAt(
  context: Context,
  tools: readonly ToolManifest[]
): ObjectAction[] {
  const registered = context.registration.tools;
  return tools.flatMap((action) => {
    const tool = registered.find(
      (candidate) => candidate.name === action.toolName
    );
    if (!tool) return [];
    return [
      {
        name: action.methodName,
        ...(action.description === undefined
          ? {}
          : { description: action.description }),
        signature: context.signature(action.parameters),
        toolName: tool.name,
        live: context.liveToolNames.has(tool.name),
      },
    ];
  });
}

function modelMember(
  className: string,
  member: PomMemberManifest
): ModelMember {
  const path = `${className}.${member.memberName}`;
  if (member.kind === "locator")
    return { name: member.memberName, kind: "locator", path };
  return {
    name: member.memberName,
    kind: "component",
    className: member.componentClassName,
    collection: member.collection,
    path,
  };
}

/**
 * The model paths, e.g. "ListItem.container", of the members the runtime
 * found resolving to their Page Object's root on some instance: the root,
 * which a model does not list among its members.
 */
function rootMemberPaths(
  registrations: readonly RegisteredPom[],
  objects: readonly PageObjectNode[]
): ReadonlySet<string> {
  const classNames = new Map(
    [...walk(objects)].map((node) => [node.path, node.className])
  );
  return new Set(
    registrations.flatMap((registration) =>
      [...registration.rootMemberPaths].flatMap((memberPath) => {
        const at = memberPath.lastIndexOf(".");
        const objectPath =
          at < 0
            ? registration.id
            : `${registration.id}.${memberPath.slice(0, at)}`;
        const className = classNames.get(objectPath);
        return className === undefined
          ? []
          : [`${className}.${memberPath.slice(at + 1)}`];
      })
    )
  );
}

function isPresent(observation: PomMemberObservation | undefined) {
  return (
    observation !== undefined &&
    observation.error === undefined &&
    observation.count > 0
  );
}

function locatorState(observation: PomMemberObservation | undefined) {
  if (!observation) return "pending";
  if (observation.error) return "probe failed";
  if (observation.count === 0) return "absent";
  return plural(observation.count, "match", "matches");
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
