import type { JsonSchema, RegisteredPomTool, ToolManifest } from "../../shared";
import type { ToolAvailability } from "../../page-state";
import { actionFacts, inputParameters, inputSchemaFor } from "./actionTool";

/** Package-internal: a Page Object Tool's facts, as the registry lists them. */
export type ScopedPomTool = RegisteredPomTool & {
  /** The component it acts on, without item indices. */
  componentPath?: string;
  /** Whether its class declares a Page Object Root. */
  rooted?: boolean;
};

/** One input rule for pages, single children and collection instances. */
export function pomToolFacts(
  pomId: string,
  className: string,
  name: string,
  componentPath: string | undefined,
  rooted: boolean,
  action: ToolManifest
): ScopedPomTool {
  const parameters = rooted
    ? [
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
          optional: inputParameters(action.parameters).every(
            (parameter) => parameter.optional
          ),
          schema: inputSchemaFor(action.parameters),
        },
      ]
    : inputParameters(action.parameters);
  return {
    pomId,
    ...(componentPath === undefined
      ? {}
      : { componentPath, componentClassName: className }),
    rooted,
    methodName: action.methodName,
    name,
    ...actionFacts(action, className),
    inputSchema: inputSchemaFor(parameters),
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
