import type {
  JsonSchema,
  PomDefinition,
  PomManifest,
  PomMemberManifest,
  PomMemberObservation,
  ToolManifest,
} from "@ayme-dev/ayme";
import type { RegisteredPom } from "@ayme-dev/ayme/internal";

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
  actions: readonly ModelAction[];
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

export type ModelAction = {
  name: string;
  description?: string;
  signature: string;
  /** Its Page Object Tools: one per place the model is used. */
  toolNames: readonly string[];
  /** The ones that are live now: their Page Object is on the page. */
  liveToolNames: readonly string[];
};

type RegisteredTool = RegisteredPom["tools"][number] & {
  componentPath?: string;
};

/**
 * Builds the page model from the registered Page Objects, the live tools
 * (the ones the panel can run now), and the Page Object Model definitions
 * snapshot returns.
 */
export function buildPageModel(
  registrations: readonly RegisteredPom[],
  liveToolNames: ReadonlySet<string>,
  definitions: readonly PomDefinition[]
): PageModel {
  const objects = registrations.map((registration) =>
    withKeys(pageObject(registration, liveToolNames), registration.id)
  );
  const instances = [...walk(objects)].filter(
    (node) => node.kind !== "collection" && node.live
  );
  const models = definitions.map((definition): PageObjectModel => ({
    className: definition.name,
    ...(definition.description === undefined
      ? {}
      : { description: definition.description }),
    members: definition.children
      .filter((member) => !isRootMember(member))
      .map((member) => modelMember(definition.name, member)),
    actions: definition.actions.map((action) => {
      const toolNames = registrations.flatMap((registration) =>
        (registration.tools as readonly RegisteredTool[])
          .filter(
            (tool) =>
              tool.methodName === action.name &&
              (tool.componentClassName ?? registration.manifest.className) ===
                definition.name
          )
          .map((tool) => tool.name)
      );
      const unique = [...new Set(toolNames)];
      return {
        name: action.name,
        ...(action.description === undefined
          ? {}
          : { description: action.description }),
        signature: signature(action.inputSchema),
        toolNames: unique,
        liveToolNames: unique.filter((name) => liveToolNames.has(name)),
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
  liveToolNames: ReadonlySet<string>
): UnkeyedNode {
  const { manifest } = registration;
  const context: Context = {
    registration,
    liveToolNames,
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
  const root = context.observations.get("root");
  return {
    path: manifest.className,
    name: manifest.className,
    kind: "page",
    className: manifest.className,
    live: root === undefined || isPresent(root),
    ...objectParts(context, manifest, "", ""),
  };
}

type Context = {
  registration: RegisteredPom;
  liveToolNames: ReadonlySet<string>;
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
    members: readonly PomMemberManifest[];
    tools: readonly ToolManifest[];
  },
  path: string,
  toolPath: string,
  ancestors: ReadonlySet<string> = new Set()
) {
  const members: ObjectMember[] = [];
  const children: UnkeyedNode[] = [];
  const pageName = context.registration.id;
  for (const member of model.members) {
    if (isRootMember(member)) continue;
    const memberPath = path
      ? `${path}.${member.memberName}`
      : member.memberName;
    const memberToolPath = toolPath
      ? `${toolPath}.${member.memberName}`
      : member.memberName;
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
    const childParts = (childPath: string, childToolPath: string) =>
      component && !ancestors.has(member.componentClassName)
        ? objectParts(context, component, childPath, childToolPath, nested)
        : { members: [], actions: [], children: [] };

    if (member.collection) {
      const count = context.observations.get(memberPath)?.count ?? 0;
      const items = Array.from({ length: count }, (_, index) => {
        const itemPath = `${memberPath}[${index}]`;
        return {
          path: `${pageName}.${itemPath}`,
          name: `[${index}]`,
          kind: "item" as const,
          className: member.componentClassName,
          live: isPresent(context.observations.get(`${itemPath}.root`)),
          ...childParts(itemPath, `${memberToolPath}[]`),
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
        actions: component
          ? actionsAt(context, component.tools, `${memberToolPath}[]`)
          : [],
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

    const live = isPresent(context.observations.get(`${memberPath}.root`));
    const child: UnkeyedNode = {
      path: `${pageName}.${memberPath}`,
      name: member.memberName,
      kind: "component",
      className: member.componentClassName,
      live,
      ...childParts(memberPath, memberToolPath),
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
    actions: actionsAt(context, model.tools, path ? toolPath : undefined),
    children,
  };
}

/** The actions of a model at one place on the page, with their tools. */
function actionsAt(
  context: Context,
  tools: readonly ToolManifest[],
  componentPath: string | undefined
): ObjectAction[] {
  const registered = context.registration.tools as readonly RegisteredTool[];
  return tools.flatMap((action) => {
    const tool = registered.find(
      (candidate) =>
        candidate.methodName === action.methodName &&
        candidate.componentPath === componentPath
    );
    if (!tool) return [];
    return [
      {
        name: action.methodName,
        ...(action.authoredDescription === undefined
          ? {}
          : { description: action.authoredDescription }),
        signature: signature(action.inputSchema),
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

function isRootMember(member: PomMemberManifest) {
  return member.kind === "locator" && member.memberName === "root";
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

/** An action's arguments, the way snapshot writes them. */
export function signature(schema: JsonSchema) {
  const required = new Set(schema.required ?? []);
  const parameters = Object.entries(schema.properties ?? {}).map(
    ([name, property]) =>
      `${name}${required.has(name) ? "" : "?"}: ${typeName(property)}`
  );
  return `(${parameters.join(", ")})`;
}

function typeName(schema: JsonSchema): string {
  if (schema.enum?.length)
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.type === "array") return `${typeName(schema.items ?? {})}[]`;
  if (schema.type === "integer") return "number";
  return schema.type ?? "unknown";
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * A Page Object Model's actions as the run slot runs them: one per live
 * tool, or one not runnable when no Page Object of it is on the page.
 */
export function modelActions(model: PageObjectModel): ObjectAction[] {
  return model.actions.flatMap((action): ObjectAction[] => {
    const live = action.liveToolNames;
    if (live.length)
      return live.map((toolName) => ({ ...action, toolName, live: true }));
    return [{ ...action, toolName: "", live: false }];
  });
}
