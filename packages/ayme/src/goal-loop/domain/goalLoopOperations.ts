import type { JsonPrimitive, JsonSchema, ToolParameter } from "../../shared";
import type { TargetField } from "../../tools";
import type { RootedToolInstance } from "../../page-objects";
import type { StartChildRun } from "../../runs";

/**
 * The operations the Goal Loop offers the model each step, and how each
 * operation's parameters are read from its schema.
 */

/** A closed set of values the model may pick one of. */
export type ClosedSet =
  | {
      kind: "ref";
      filter: (element: Element) => boolean;
      /** The filter before reach, for a tool that needs reach. */
      matches?: (element: Element) => boolean;
    }
  /**
   * The present items of one collection path, each with the tool's verdict on
   * it; no filter is involved.
   */
  | { kind: "instance"; roots: readonly RootedToolInstance[] }
  | { kind: "values"; values: readonly JsonPrimitive[] };

/** The Goal Values a parameter or list item outside the closed sets can take. */
export type FreeKind = "string" | "number" | "integer";

/** A key of an operation's input: a property name, or a tuple slot's index. */
export type PathKey = string | number;

/** A tuple some parameters are slots of, and how many slots it requires. */
export type TupleSpec = {
  path: readonly PathKey[];
  minItems: number;
  optional: boolean;
};

/** One parameter of an operation, classified by what the model may fill. */
export type ArgumentSpec = {
  /** The parameter's name, dotted inside a nested object or tuple. */
  name: string;
  /** Where the chosen value goes in the operation's input. */
  path: readonly PathKey[];
  optional: boolean;
  /** The parameter's own description, when its schema carries one. */
  description?: string;
  /**
   * The values the model may pick from; null when there are none. A union of
   * primitives carries its enum values, booleans and null here, next to the
   * Goal Values its other variants take.
   */
  closedSet: ClosedSet | null;
  /**
   * The Goal Values that fit the parameter, by type. Absent when none ever
   * can, such as for an object or a map.
   */
  free?: readonly FreeKind[];
  /**
   * A list: each value of its closed set and each fitting Goal Value is asked
   * about on its own, and the ones included are the list.
   */
  list?: true;
  /** The tuples the parameter is a slot of, outermost first. */
  tuples?: readonly TupleSpec[];
};

export type GoalLoopOperation = {
  name: string;
  description: string;
  /**
   * Runs the tool as a step, a child Run of the goal Run through `run`, which
   * reads with the goal Run's fork of its Caller's cursor.
   */
  execute(input: unknown, run: StartChildRun): Promise<unknown>;
  /** Parameter names a caller must pass; empty when the tool takes none. */
  requiredParams: string[];
  args: ArgumentSpec[];
};

export type ToolOption = {
  key: string;
  label: string;
  tool: GoalLoopOperation;
};

/** What a primitive schema may be filled with. */
type PrimitiveFill = { values: JsonPrimitive[]; free: FreeKind[] };

function closedFill(values: JsonPrimitive[]): PrimitiveFill {
  return { values, free: [] };
}

/**
 * The closed values (enum values, booleans, null) and the Goal Value kinds a
 * primitive schema, or a union of them, takes; undefined for any other schema.
 */
function primitiveFillOf(schema: JsonSchema): PrimitiveFill | undefined {
  if (schema.anyOf) {
    const fills = schema.anyOf.map(primitiveFillOf);
    if (fills.includes(undefined)) return undefined;
    // The build plugin merges literals of one type into one enum, so the
    // variants never share a value or a kind.
    return {
      values: fills.flatMap((fill) => fill!.values),
      free: fills.flatMap((fill) => fill!.free),
    };
  }
  if (schema.enum) return closedFill([...schema.enum]);
  switch (schema.type) {
    case "boolean":
      return closedFill([true, false]);
    case "null":
      return closedFill([null]);
    case "string":
    case "number":
    case "integer":
      return { values: [], free: [schema.type] };
    default:
      return undefined;
  }
}

/**
 * What the items of an array schema may be filled with. A list of booleans,
 * of objects or of lists is never filled.
 */
function listFillOf(schema: JsonSchema): PrimitiveFill | undefined {
  if (!schema.items || schema.items.type === "boolean") return undefined;
  return primitiveFillOf(schema.items);
}

/** A parameter, or a tuple slot, read the way `specsOf` reads it. */
type ParameterToClassify = {
  name: PathKey;
  optional: boolean;
  schema: JsonSchema;
};

/**
 * Classify a parameter. A tuple is not one parameter but its slots, each
 * classified on its own like an object property; a slot of an optional tuple,
 * or past the tuple's required ones, is optional. Elements after the slots,
 * as in `[string, ...number[]]`, are never filled.
 */
function specsOf(
  parameter: ParameterToClassify,
  prefix: readonly PathKey[] = [],
  tuples: readonly TupleSpec[] = []
): ArgumentSpec[] {
  const { schema } = parameter;
  const path = [...prefix, parameter.name];
  if (schema.prefixItems) {
    const tuple = {
      path,
      minItems: schema.minItems ?? 0,
      optional: parameter.optional,
    };
    return schema.prefixItems.flatMap((slot, index) =>
      specsOf(
        {
          name: index,
          optional: parameter.optional || index >= tuple.minItems,
          schema: slot,
        },
        path,
        [...tuples, tuple]
      )
    );
  }
  const list = schema.type === "array";
  const fill = list ? listFillOf(schema) : primitiveFillOf(schema);
  return [
    {
      ...specBase(path, parameter),
      closedSet: fill?.values.length
        ? { kind: "values", values: fill.values }
        : null,
      ...(fill?.free.length ? { free: fill.free } : {}),
      ...(list ? { list: true as const } : {}),
      ...(tuples.length ? { tuples } : {}),
    },
  ];
}

/** A parameter whose closed set is given, such as the ref a tool acts on. */
function closedSpecOf(
  parameter: ToolParameter,
  closedSet: ClosedSet
): ArgumentSpec {
  return { ...specBase([parameter.name], parameter), closedSet };
}

function specBase(
  path: readonly PathKey[],
  parameter: ParameterToClassify
): Pick<ArgumentSpec, "name" | "path" | "optional" | "description"> {
  return {
    name: path.join("."),
    path,
    optional: parameter.optional,
    ...(parameter.schema.description
      ? { description: parameter.schema.description }
      : {}),
  };
}

/** Classify every parameter of an action, its tuples' slots one by one. */
export function specsOfParameters(
  parameters: readonly ToolParameter[]
): ArgumentSpec[] {
  return parameters.flatMap((parameter) => specsOf(parameter));
}

/** The parameters of an object schema, each a `ToolParameter`. */
function parametersOfObjectSchema(schema: JsonSchema): ToolParameter[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(
    ([name, propertySchema]) => ({
      name,
      optional: !required.has(name),
      schema: propertySchema,
    })
  );
}

/** Read an object schema as the parameters the loop may fill, under `prefix`. */
export function specsOfObjectSchema(
  schema: JsonSchema,
  prefix: readonly PathKey[] = []
): ArgumentSpec[] {
  return parametersOfObjectSchema(schema).flatMap((parameter) =>
    specsOf(parameter, prefix)
  );
}

/** Read a single-element tool's input schema the same way. */
export function specsOfElementToolSchema(
  schema: JsonSchema,
  targetField: TargetField,
  refs: Extract<ClosedSet, { kind: "ref" }>
): ArgumentSpec[] {
  return parametersOfObjectSchema(schema).flatMap((parameter) =>
    // Its `ref` or `target` is the Structural Ref it acts on; the elements its
    // filter keeps are the closed set (ADR-0023).
    parameter.name === targetField
      ? [closedSpecOf(parameter, refs)]
      : specsOf(parameter)
  );
}

/**
 * A rooted Page Object Tool takes `{ ref, args }`: the ref
 * addresses one present instance of its path, the action's own parameters sit
 * inside `args` and are classified like any other parameter.
 */
export function specsOfRootedTool(
  parameters: readonly ToolParameter[],
  roots: readonly RootedToolInstance[]
): ArgumentSpec[] {
  return parameters.flatMap((parameter) =>
    parameter.name === "ref"
      ? [
          {
            name: "ref",
            path: ["ref"],
            optional: parameter.optional,
            closedSet: { kind: "instance", roots } as const,
          },
        ]
      : specsOfObjectSchema(parameter.schema, [parameter.name])
  );
}

/**
 * The parameters a caller must pass, by name: for a rooted tool, its `ref` and the required ones inside `args`, dotted.
 */
export function requiredParamsOf(
  parameters: readonly ToolParameter[],
  rooted: boolean
): string[] {
  return parameters.flatMap((parameter) =>
    rooted && parameter.name !== "ref"
      ? parametersOfObjectSchema(parameter.schema)
          .filter((inner) => !inner.optional)
          .map((inner) => `${parameter.name}.${inner.name}`)
      : parameter.optional
        ? []
        : [parameter.name]
  );
}
