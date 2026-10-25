import type {
  PomDefinition,
  PomDefinitionAction,
  PomDefinitionsResult,
  PomManifest,
} from "../../shared";
import { inputSchemaFor } from "./actionTool";
import { ToolInputError } from "../../shared";

type DefinitionNode = {
  name: string;
  description?: string;
  members: PomManifest["members"];
  tools: PomManifest["tools"];
};

/**
 * Package-internal: the definitions of the classes `manifests` reach, the
 * ones `names` names or, without names, all of them. A name no class has is
 * left out.
 */
export function pomDefinitionsOf(
  manifests: readonly PomManifest[],
  names: readonly string[]
): PomDefinitionsResult {
  if (!names.every((name) => typeof name === "string"))
    throw new ToolInputError("POM definition names must be strings.");

  const index = definitionIndex(manifests);
  if (names.length > 0)
    return {
      definitions: names.flatMap((name) => {
        const definition = index.get(name);
        return definition ? [definition] : [];
      }),
    };

  return { definitions: [...index.values()] };
}

/**
 * Every class `manifests` reach, by name. Registration refuses two different
 * classes with one name, so each name has one definition.
 */
function definitionIndex(manifests: readonly PomManifest[]) {
  const definitions = new Map<string, PomDefinition>();
  for (const manifest of manifests) {
    for (const definition of reachableDefinitions(manifest))
      definitions.set(definition.name, definition);
  }
  return definitions;
}

function reachableDefinitions(manifest: PomManifest) {
  const nodes = nodesFor(manifest);
  const reachable: PomDefinition[] = [];
  const visited = new Set<string>();
  const pending = [manifest.className];

  while (pending.length > 0) {
    const name = pending.shift();
    if (!name || visited.has(name)) continue;
    visited.add(name);
    const node = nodes.get(name);
    if (!node) continue;
    const definition = definitionFor(node);
    reachable.push(definition);
    pending.push(
      ...definition.children.flatMap((child) =>
        child.kind === "component" ? [child.componentClassName] : []
      ),
      ...definition.actions.flatMap((action) => action.returnPoms)
    );
  }
  return reachable;
}

function nodesFor(manifest: PomManifest) {
  return new Map(
    [manifest, ...manifest.components].map((node): [string, DefinitionNode] => [
      node.className,
      {
        name: node.className,
        ...(node.description === undefined
          ? {}
          : { description: node.description }),
        members: node.members,
        tools: node.tools,
      },
    ])
  );
}

function definitionFor(node: DefinitionNode): PomDefinition {
  const actions: PomDefinitionAction[] = node.tools.map((tool) => ({
    name: tool.methodName,
    ...(tool.description === undefined
      ? {}
      : { description: tool.description }),
    inputSchema: inputSchemaFor(tool.parameters),
    returnPoms: tool.returnPoms ?? [],
  }));
  return {
    name: node.name,
    ...(node.description === undefined
      ? {}
      : { description: node.description }),
    children: node.members,
    actions,
  };
}
