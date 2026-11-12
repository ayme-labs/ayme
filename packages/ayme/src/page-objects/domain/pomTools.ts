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
          name: "id",
          optional: true,
          schema: {
            type: "string",
            description:
              "The Page Object's id, written po<n>, as the page state prints it on its Page Object Root. Given instead of ref.",
          } satisfies JsonSchema,
        },
        {
          name: "ref",
          optional: true,
          schema: {
            type: "string",
            description:
              "Structural Ref of the instance's Page Object Root, as marked in the page state. Given instead of id.",
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
