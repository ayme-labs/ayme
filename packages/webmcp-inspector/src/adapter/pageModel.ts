import type {
  JsonSchema,
  PomDefinition,
  PomManifest,
  PomMemberManifest,
  PomMemberObservation,
  ToolManifest,
} from "@ayme-dev/webmcp";
import type { RegisteredPom } from "@ayme-dev/webmcp/internal";

/**
 * The page model the Model lens shows: the Page Objects on the page as a
 * tree, and the Page Object Models the page knows.
 */
export type PageModel = {
  /** The page Page Objects, each with its tree of children. */
  objects: readonly PageObjectNode[];
  /** The Page Object Models get_page_context describes, in its order. */
  models: readonly PageObjectModel[];
};

export const emptyPageModel: PageModel = { objects: [], models: [] };

/**
 * A node of the object tree: a page, a child Page Object, a collection, or
 * one item of a collection.
 */
export type PageObjectNode = {
  /** Its path from the page, e.g. "ListPage.items[1]". Unique on the page. */
  path: string;
  /** Its name under its parent: "ListPage", "archiveDialog", "items" or "[1]". */
  name: string;
  kind: "page" | "component" | "collection" | "item";
  /** Its Page Object Model; a collection's items' model. */
  className: string;
  /** Whether it is on the page now. A collection is when it has items. */
  live: boolean;
  /** A collection's item count. */
  itemCount?: number;
  /** The registry path that highlights it on the page. */
  highlightPath?: string;
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
  highlightPath?: string;
  /** A child Page Object's or collection's path, to go to it. */
  objectPath?: string;
};

export type ObjectAction = {
  name: string;
  description?: string;
  /** Its arguments, e.g. "(text: string)". */
  signature: string;
  /** Its Generated WebMCP Tool. */
  toolName: string;
  /** Whether WebMCP publishes the tool now. */
  published: boolean;
};

/** A Page Object Model, as get_page_context describes it. */
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
  /** The registry path that highlights it on every instance. */
  highlightPath?: string;
};

export type ModelAction = {
  name: string;
  description?: string;
  signature: string;
  /** Its Generated WebMCP Tools: one per place the model is used. */
  toolNames: readonly string[];
  /** The tools WebMCP publishes now. */
  publishedToolNames: readonly string[];
};

type RegisteredTool = RegisteredPom["tools"][number] & {
  componentPath?: string;
};

/**
 * Builds the page model from the registered Page Objects, the tools WebMCP
 * publishes now, and the Page Object Model definitions get_page_context
 * returns.
 */
export function buildPageModel(
  registrations: readonly RegisteredPom[],
  publishedToolNames: ReadonlySet<string>,
  definitions: readonly PomDefinition[]
): PageModel {
  const objects = registrations.map((registration) =>
    pageObject(registration, publishedToolNames)
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
        publishedToolNames: unique.filter((name) =>
          publishedToolNames.has(name)
        ),
      };
    }),
    instancePaths: instances
      .filter((node) => node.className === definition.name)
      .map((node) => node.path),
  }));
  return { objects, models };
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
  publishedToolNames: ReadonlySet<string>
): PageObjectNode {
  const { manifest } = registration;
  const context: Context = {
    registration,
    publishedToolNames,
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
    ...(manifest.members.some(isRootMember)
      ? { highlightPath: `${registration.id}.root` }
      : {}),
    ...objectParts(context, manifest, ""),
  };
}

type Context = {
  registration: RegisteredPom;
  publishedToolNames: ReadonlySet<string>;
  components: ReadonlyMap<string, PomManifest["components"][number]>;
  observations: ReadonlyMap<string, PomMemberObservation>;
};

/** A Page Object's members, actions and children, at a path from its page. */
function objectParts(
  context: Context,
  model: {
    members: readonly PomMemberManifest[];
    tools: readonly ToolManifest[];
  },
  path: string,
  ancestors: ReadonlySet<string> = new Set()
) {
  const members: ObjectMember[] = [];
  const children: PageObjectNode[] = [];
  const pageName = context.registration.id;
  for (const member of model.members) {
    if (isRootMember(member)) continue;
    const memberPath = path
      ? `${path}.${member.memberName}`
      : member.memberName;
    if (member.kind === "locator") {
      const observation = context.observations.get(memberPath);
      members.push({
        name: member.memberName,
        kind: "locator",
        live: observation !== undefined && isPresent(observation),
        state: locatorState(observation),
        highlightPath: `${pageName}.${memberPath}`,
      });
      continue;
    }

    const component = context.components.get(member.componentClassName);
    const nested = new Set(ancestors).add(member.componentClassName);
    const childParts = (childPath: string) =>
      component && !ancestors.has(member.componentClassName)
        ? objectParts(context, component, childPath, nested)
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
          highlightPath: `${pageName}.${itemPath}.root`,
          ...childParts(itemPath),
        };
      });
      const collection: PageObjectNode = {
        path: `${pageName}.${memberPath}`,
        name: member.memberName,
        kind: "collection",
        className: member.componentClassName,
        live: count > 0,
        itemCount: count,
        highlightPath: `${pageName}.${memberPath}`,
        members: items.map((item) => ({
          name: item.name,
          kind: "component",
          className: member.componentClassName,
          live: item.live,
          state: item.live ? "on page" : "not on page",
          highlightPath: item.highlightPath,
          objectPath: item.path,
        })),
        actions: component
          ? actionsAt(context, component.tools, `${memberPath}[]`)
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
        highlightPath: collection.highlightPath,
        objectPath: collection.path,
      });
      continue;
    }

    const live = isPresent(context.observations.get(`${memberPath}.root`));
    const child: PageObjectNode = {
      path: `${pageName}.${memberPath}`,
      name: member.memberName,
      kind: "component",
      className: member.componentClassName,
      live,
      highlightPath: `${pageName}.${memberPath}.root`,
      ...childParts(memberPath),
    };
    children.push(child);
    members.push({
      name: member.memberName,
      kind: "component",
      className: member.componentClassName,
      live,
      state: live ? "on page" : "not on page",
      highlightPath: child.highlightPath,
      objectPath: child.path,
    });
  }

  const toolPath = path.replace(/\[\d+\]/g, "[]");
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
        published: context.publishedToolNames.has(tool.name),
      },
    ];
  });
}

function modelMember(
  className: string,
  member: PomMemberManifest
): ModelMember {
  if (member.kind === "locator")
    return {
      name: member.memberName,
      kind: "locator",
      highlightPath: `${className}.${member.memberName}`,
    };
  return {
    name: member.memberName,
    kind: "component",
    className: member.componentClassName,
    collection: member.collection,
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

/** An action's arguments, the way get_page_context writes them. */
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
