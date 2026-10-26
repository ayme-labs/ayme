import type { JsonSchema, RegisteredPomTool, ToolManifest } from "../../shared";
import { actionFacts, inputParameters, inputSchemaFor } from "./actionTool";

/** One input rule for pages, single children and collection instances. */
export function pomToolFacts(
  className: string,
  rooted: boolean,
  action: ToolManifest
): RegisteredPomTool {
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
    className,
    rooted,
    methodName: action.methodName,
    name: action.toolName,
    ...actionFacts(action, className),
    inputSchema: inputSchemaFor(parameters),
    parameters,
  };
}
