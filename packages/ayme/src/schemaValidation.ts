import { isJsonPrimitive, type JsonSchema } from "./contracts";
import { ToolInputError } from "./errors";

/**
 * Package-internal: where a value breaks its schema, as a path such as
 * `values.zip` or `tags[1]`, and how, e.g. "must be a string or a number".
 */
export type SchemaViolation = { path: string; message: string };

/**
 * Package-internal: every way a tool's input breaks its object schema. A
 * property the schema does not declare is a violation by name, never
 * ignored, whether or not the schema says `additionalProperties: false`.
 */
export function toolInputViolations(
  schema: JsonSchema,
  input: unknown
): SchemaViolation[] {
  if (!isRecord(input)) return [{ path: "", message: "must be an object" }];
  return schemaViolations(
    {
      ...schema,
      type: "object",
      additionalProperties:
        typeof schema.additionalProperties === "object"
          ? schema.additionalProperties
          : false,
    },
    input
  );
}

/** Package-internal: every way a value breaks its schema, in document order. */
export function schemaViolations(
  schema: JsonSchema,
  value: unknown,
  path = ""
): SchemaViolation[] {
  const at = (message: string): SchemaViolation[] => [{ path, message }];

  if (schema.anyOf?.length) {
    const results = schema.anyOf.map((variant) =>
      schemaViolations(variant, value, path)
    );
    if (results.some((violations) => violations.length === 0)) return [];
    // Only one variant has the value's type: its own violations say more.
    const sameType = schema.anyOf.flatMap((variant, index) =>
      variant.type !== undefined && hasType(value, variant.type)
        ? [results[index]!]
        : []
    );
    if (sameType.length === 1) return sameType[0]!;
    return at(`must be ${schema.anyOf.map(describe).join(" or ")}`);
  }

  if (schema.type !== undefined && !hasType(value, schema.type))
    return at(`must be ${describe({ type: schema.type })}`);

  const violations: SchemaViolation[] = [];
  if (schema.type === "array" && Array.isArray(value) && schema.items)
    value.forEach((item, index) =>
      violations.push(
        ...schemaViolations(schema.items!, item, `${path}[${index}]`)
      )
    );
  if (schema.type === "object" && isRecord(value))
    violations.push(...objectViolations(schema, value, path));
  if (
    schema.minimum !== undefined &&
    (typeof value !== "number" || value < schema.minimum)
  )
    violations.push(...at(`must be at least ${schema.minimum}`));
  if (schema.enum && (!isJsonPrimitive(value) || !schema.enum.includes(value)))
    violations.push(...at(`must be ${describe({ enum: schema.enum })}`));
  return violations;
}

function objectViolations(
  schema: JsonSchema,
  object: Record<string, unknown>,
  path: string
): SchemaViolation[] {
  const child = (name: string) => (path ? `${path}.${name}` : name);
  const properties = schema.properties ?? {};
  const extra = schema.additionalProperties;
  const violations: SchemaViolation[] = [];
  for (const [name, value] of Object.entries(object)) {
    if (value === undefined) continue;
    if (Object.hasOwn(properties, name))
      violations.push(
        ...schemaViolations(properties[name]!, value, child(name))
      );
    else if (extra === false)
      violations.push({ path: child(name), message: "is not supported" });
    else if (typeof extra === "object")
      violations.push(...schemaViolations(extra, value, child(name)));
  }
  for (const name of schema.required ?? [])
    if (object[name] === undefined)
      violations.push({ path: child(name), message: "is required" });
  const count = Object.values(object).filter(
    (value) => value !== undefined
  ).length;
  if (schema.minProperties !== undefined && count < schema.minProperties)
    violations.push({
      path,
      message: `must have at least ${entries(schema.minProperties)}`,
    });
  if (schema.maxProperties !== undefined && count > schema.maxProperties)
    violations.push({
      path,
      message: `must have at most ${entries(schema.maxProperties)}`,
    });
  return violations;
}

/**
 * Package-internal: throw the first violation as a ToolInputError, e.g.
 * "Input property values.zip must be a string or a number."
 */
export function throwFirstViolation(violations: readonly SchemaViolation[]) {
  const [first] = violations;
  if (!first) return;
  throw new ToolInputError(
    first.path
      ? `Input property ${first.path} ${first.message}.`
      : `Tool input ${first.message}.`
  );
}

function hasType(value: unknown, type: NonNullable<JsonSchema["type"]>) {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    default:
      return typeof value === type;
  }
}

/** What a schema takes, e.g. "a string", "an integer" or "one of a, b". */
function describe(schema: JsonSchema): string {
  if (schema.enum) return `one of ${schema.enum.join(", ")}`;
  switch (schema.type) {
    case undefined:
      return "a JSON value";
    case "array":
    case "object":
    case "integer":
      return `an ${schema.type}`;
    default:
      return `a ${schema.type}`;
  }
}

function entries(count: number) {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
