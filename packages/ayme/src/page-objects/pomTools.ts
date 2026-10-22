import type { JsonSchema, RegisteredPomTool, ToolManifest } from "../shared";
import type { ToolAvailability } from "../page-state";
import { actionFacts, inputParameters, inputSchemaFor } from "./actionTool";
import type { PomGroup } from "./pomTree";

/** Package-internal: a Page Object Tool's facts, as the registry lists them. */
export type ScopedPomTool = RegisteredPomTool & {
  /** The component it acts on, without item indices, e.g. "items[].details". */
  componentPath?: string;
  /**
   * For a tool that goes through a collection, the path of the items a
   * ref names, e.g. "items[]" for "items[].details".
   */
  collectionPath?: string;
};

/** Package-internal: the tool of the Page Object `pomId`'s own `action`. */
export function pageToolFacts(
  pomId: string,
  action: ToolManifest
): ScopedPomTool {
  return {
    pomId,
    methodName: action.methodName,
    name: action.toolName,
    ...actionFacts(action, pomId),
    inputSchema: inputSchemaFor(action.parameters),
    parameters: inputParameters(action.parameters),
  };
}

/**
 * Package-internal: the tool of `action` of the component at `group` in the
 * Page Object `pomId`. A tool that goes through a collection takes the ref
 * of the item it acts on, and the action's arguments as `args`.
 */
export function componentToolFacts(
  pomId: string,
  { component, key, toolPath, collectionKey }: PomGroup,
  action: ToolManifest
): ScopedPomTool {
  if (collectionKey === undefined)
    return {
      pomId,
      componentClassName: component.className,
      componentPath: key,
      methodName: action.methodName,
      name: `${pomId}.${toolPath}.${action.methodName}`,
      ...actionFacts(action, component.className),
      inputSchema: inputSchemaFor(action.parameters),
      parameters: inputParameters(action.parameters),
    };
  const wrapper = refComponentToolManifest(pomId, toolPath, action);
  return {
    pomId,
    componentClassName: component.className,
    componentPath: key,
    collectionPath: collectionKey,
    methodName: action.methodName,
    name: wrapper.toolName,
    ...actionFacts(action, component.className),
    inputSchema: inputSchemaFor(wrapper.parameters),
    parameters: wrapper.parameters,
  };
}

function refComponentToolManifest(
  pomId: string,
  toolPath: string,
  action: ToolManifest
): ToolManifest {
  const parameters = [
    {
      name: "ref",
      optional: false,
      schema: {
        type: "string",
        description:
          "Structural Ref of the instance's Page Object Root, as labelled in the page state.",
      } satisfies JsonSchema,
    },
    {
      name: "args",
      // An action that needs no input runs on `{}`, so `args` may be omitted.
      optional: inputParameters(action.parameters).every(
        (parameter) => parameter.optional
      ),
      schema: inputSchemaFor(action.parameters),
    },
  ];

  return {
    ...action,
    toolName: `${pomId}.${toolPath}.${action.methodName}`,
    parameters,
  };
}

/**
 * Package-internal: whether a tool with `candidate`'s availability is listed
 * instead of `listed`, an earlier one of the same name: the first available
 * one wins, else the first present, else the first registered.
 */
export function listedInstead(
  candidate: ToolAvailability,
  listed: ToolAvailability | undefined
): boolean {
  return (
    !listed ||
    (candidate.available && !listed.available) ||
    (candidate.present && !listed.present)
  );
}
