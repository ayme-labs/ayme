import type {
  PomComponentManifest,
  PomDefinition,
  PomDefinitionAction,
  PomDefinitionsResult,
  PomManifest,
} from "./contracts";
import { listRegisteredPoms } from "./registry";

type DefinitionNode = {
  name: string;
  description?: string;
  members: PomManifest["members"];
  tools: PomManifest["tools"];
};

export function getPomDefinitions(
  ...names: readonly string[]
): PomDefinitionsResult {
  const index = definitionIndex();
  if (names.length > 0)
    return {
      definitions: names.flatMap((name) =>
        unambiguousDefinitions(name, index.get(name) ?? [])
      ),
    };

  return {
    definitions: [...index.entries()].flatMap(([definitionName, candidates]) =>
      unambiguousDefinitions(definitionName, candidates)
    ),
  };
}

function unambiguousDefinitions(
  name: string,
  candidates: readonly PomDefinition[]
) {
  const definitions = distinctDefinitions(candidates);
  if (definitions.length > 1)
    throw new Error(`POM definition "${name}" is ambiguous.`);
  return definitions;
}

function definitionIndex() {
  const definitions = new Map<string, PomDefinition[]>();
  for (const registration of listRegisteredPoms()) {
    for (const definition of reachableDefinitions(registration.manifest)) {
      const candidates = definitions.get(definition.name) ?? [];
      candidates.push(definition);
      definitions.set(definition.name, candidates);
    }
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
    for (const node of nodes.get(name) ?? []) {
      const definition = definitionFor(node);
      reachable.push(definition);
      pending.push(
        ...definition.children.flatMap((child) =>
          child.kind === "component" ? [child.componentClassName] : []
        ),
        ...definition.actions.flatMap((action) => action.returnPoms)
      );
    }
  }
  return reachable;
}

function nodesFor(manifest: PomManifest) {
  const nodes = new Map<string, DefinitionNode[]>();
  addNode(nodes, manifest);
  for (const component of manifest.components) addNode(nodes, component);
  return nodes;
}

function addNode(
  nodes: Map<string, DefinitionNode[]>,
  node: PomManifest | PomComponentManifest
) {
  const candidates = nodes.get(node.className) ?? [];
  candidates.push({
    name: node.className,
    ...(node.description === undefined
      ? {}
      : { description: node.description }),
    members: node.members,
    tools: node.tools,
  });
  nodes.set(node.className, candidates);
}

function definitionFor(node: DefinitionNode): PomDefinition {
  const actions: PomDefinitionAction[] = node.tools.map((tool) => ({
    name: tool.methodName,
    ...(tool.authoredDescription === undefined
      ? {}
      : { description: tool.authoredDescription }),
    inputSchema: tool.inputSchema,
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

function distinctDefinitions(definitions: readonly PomDefinition[]) {
  const unique = new Map<string, PomDefinition>();
  for (const definition of definitions) {
    unique.set(JSON.stringify(definition), definition);
  }
  return [...unique.values()];
}
