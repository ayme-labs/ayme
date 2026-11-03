import type {
  JsonSchema,
  NamedToolParameter,
  ToolManifest,
  ToolParameter,
} from "../../shared";

/** A parameter as agents read it: whether they may leave it out, and its schema. */
export type InputParameter = {
  name: string;
  optional: boolean;
  schema: JsonSchema;
};

/**
 * An action's parameters as agents read them, a destructured parameter's
 * fields beside the others: a literal default sits in the schema, and a
 * rest parameter or element with no minimum, or a field of an optional
 * pattern, may be left out.
 */
export function inputParameters(
  parameters: readonly ToolParameter[]
): InputParameter[] {
  return parameters.flatMap((parameter) =>
    "destructured" in parameter
      ? parameter.fields.map((field) =>
          inputParameter(field, parameter.optional)
        )
      : [inputParameter(parameter, false)]
  );
}

function inputParameter(
  parameter: NamedToolParameter,
  inOptionalPattern: boolean
): InputParameter {
  return {
    name: parameter.name,
    optional:
      inOptionalPattern ||
      parameter.optional ||
      (parameter.rest === true && !parameter.schema.minItems),
    schema:
      parameter.default === undefined
        ? parameter.schema
        : { ...parameter.schema, default: parameter.default },
  };
}

/** A field the type requires, as agents read it: a rest with no minimum is not. */
export function typeRequires(field: NamedToolParameter): boolean {
  return !inputParameter(field, false).optional;
}

/** Where an input breaks a rule its schema cannot state, and how. */
export type InputViolation = { path: string; message: string };

/**
 * How the input breaks the rule a defaulted pattern keeps beside its
 * schema, which leaves each of its fields optional: all or nothing. Given
 * any of its fields, it needs every one its type requires, named under
 * `prefix`, as in a rooted action's `args`.
 */
export function patternViolations(
  parameters: readonly ToolParameter[],
  input: Readonly<Record<string, unknown>>,
  prefix?: string
): InputViolation[] {
  const given = (name: string) => Object.hasOwn(input, name);
  return parameters.flatMap((parameter) => {
    if (!("destructured" in parameter) || !parameter.optional) return [];
    const first = parameter.fields.find((field) => given(field.name));
    if (!first) return [];
    return parameter.fields
      .filter((field) => typeRequires(field) && !given(field.name))
      .map((field) => ({
        path: prefix === undefined ? field.name : `${prefix}.${field.name}`,
        message: `is required when ${first.name} is given`,
      }));
  });
}

/** The object schema an action's arguments are validated against. */
export function inputSchemaFor(
  parameters: readonly ToolParameter[]
): JsonSchema {
  const input = inputParameters(parameters);
  return {
    type: "object",
    properties: Object.fromEntries(
      input.map((parameter) => [parameter.name, parameter.schema])
    ),
    required: input
      .filter((parameter) => !parameter.optional)
      .map((parameter) => parameter.name),
    additionalProperties: false,
  };
}

/**
 * What a Page Object Tool tells about its action beyond its name and schema:
 * the description its author wrote, the other Page Objects it may return,
 * which the page shows afterwards, and its Agent Description, the text an
 * agent reads from the two. A blank description, or returning its own class,
 * tells nothing, so it is left out.
 */
export function actionFacts(
  action: ToolManifest,
  ownClassName: string
): {
  authorDescription?: string;
  agentDescription?: string;
  returnPoms?: readonly string[];
} {
  const returnPoms =
    action.returnPoms?.filter((name) => name !== ownClassName) ?? [];
  // A blank description says nothing, and WebMCP refuses an empty one.
  const authorDescription = action.description?.trim()
    ? action.description
    : undefined;
  const agentDescription = describeAction(authorDescription, returnPoms);
  return {
    ...(authorDescription === undefined ? {} : { authorDescription }),
    ...(agentDescription === undefined ? {} : { agentDescription }),
    ...(returnPoms.length ? { returnPoms } : {}),
  };
}

/**
 * The author's description, then the Page Objects the page shows
 * afterwards, by class: `Shows A or B.` alone, `Then shows A or B.` after
 * the author's text. None when the action says nothing beyond its name and
 * schema.
 */
function describeAction(
  authorDescription: string | undefined,
  returnPoms: readonly string[]
): string | undefined {
  if (!returnPoms.length) return authorDescription;
  const shown = returnPoms.join(" or ");
  return authorDescription === undefined
    ? `Shows ${shown}.`
    : `${authorDescription} Then shows ${shown}.`;
}

/**
 * A tool's description for a reader that needs one of every tool: its Agent
 * Description, or `Run addItem.` when it has none. WebMCP refuses a tool
 * without a description, and the Goal Loop's model chooses an operation by
 * it.
 */
export function requiredDescription(tool: {
  name: string;
  agentDescription?: string;
}): string {
  return (
    tool.agentDescription ??
    `Run ${tool.name.slice(tool.name.lastIndexOf(".") + 1)}.`
  );
}

/**
 * The method's arguments from its tool's input, which the runtime checked:
 * a destructured parameter's fields collected back into one object or
 * array, and a rest parameter's list spread into the remaining arguments.
 * An optional pattern none of whose fields are given is left out, so its
 * default applies.
 */
export function methodArguments(
  parameters: readonly ToolParameter[],
  input: Readonly<Record<string, unknown>>
): unknown[] {
  // An inherited name, such as constructor, is no argument.
  const given = (name: string) => Object.hasOwn(input, name);
  // A rest parameter's or element's list is its remaining values.
  const values = (field: NamedToolParameter) => {
    const value = given(field.name) ? input[field.name] : undefined;
    return field.rest ? ((value as unknown[] | undefined) ?? []) : [value];
  };
  return parameters.flatMap((parameter) => {
    if (!("destructured" in parameter)) return values(parameter);
    const fields = parameter.fields.filter((field) => given(field.name));
    if (parameter.optional && fields.length === 0) return [undefined];
    if (parameter.destructured === "object")
      return [
        Object.fromEntries(
          fields.map((field) => [field.name, input[field.name]])
        ),
      ];
    const array = parameter.fields.flatMap(values);
    return parameter.rest ? array : [array];
  });
}
