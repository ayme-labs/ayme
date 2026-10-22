export type JsonPrimitive = string | number | boolean | null;

export type JsonSchema = {
  type?:
    "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  description?: string;
  items?: JsonSchema;
  /** A tuple's elements, in order; `items` then takes any further ones. */
  prefixItems?: readonly JsonSchema[];
  minItems?: number;
  maxItems?: number;
  enum?: readonly JsonPrimitive[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  minProperties?: number;
  maxProperties?: number;
  anyOf?: readonly JsonSchema[];
  minimum?: number;
  default?: JsonPrimitive;
};

export function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}
