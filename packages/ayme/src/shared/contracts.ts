import {
  isJsonPrimitive,
  type JsonPrimitive,
  type JsonSchema,
} from "@ayme-dev/core/tool-input";

export { isJsonPrimitive };
export type { JsonPrimitive, JsonSchema };

export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A Page Object Action's parameter, as TypeScript declares it. */
export type ToolParameter = {
  name: string;
  /** Declared optional: `?`, an initializer, or `| undefined`. */
  optional: boolean;
  schema: JsonSchema;
  /** A rest parameter: the action takes its list as separate arguments. */
  rest?: true;
  /** The initializer's value, when it is a literal. */
  default?: JsonPrimitive;
};

export type PomMemberAccess = "field" | "getter" | "method";

export type PomLocatorMemberManifest = {
  memberName: string;
  kind: "locator";
  access: PomMemberAccess;
};

export type PomComponentMemberManifest = {
  memberName: string;
  kind: "component";
  access: PomMemberAccess;
  componentClassName: string;
  collection: boolean;
};

export type PomMemberManifest =
  PomLocatorMemberManifest | PomComponentMemberManifest;

export type PomComponentManifest = {
  className: string;
  /**
   * The file declaring the class, as its package's name and its path there.
   * Ayme tells classes apart by name; this tells a recompiled class from a
   * different one with the same name.
   */
  file?: string;
  description?: string;
  members: readonly PomMemberManifest[];
  tools: readonly ToolManifest[];
};

export type PomMemberObservation = {
  memberName: string;
  kind: "locator" | "component-root" | "component-collection";
  count: number;
  access?: PomMemberAccess;
  error?: string;
  /** Whether this observation is a documented console diagnostic. */
  diagnostic?: boolean;
};

/**
 * A Page Object Action as the compiler finds it in TypeScript. `actionTool.ts`
 * derives the input schema and description agents read.
 */
export type ToolManifest = {
  methodName: string;
  toolName: string;
  /** The description its `@ayme.action` marker gives. */
  description?: string;
  parameters: readonly ToolParameter[];
  returnPoms?: readonly string[];
};

export type PomManifest = {
  className: string;
  file?: string;
  description?: string;
  members: readonly PomMemberManifest[];
  components: readonly PomComponentManifest[];
  tools: readonly ToolManifest[];
};

export type PomDefinitionAction = {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  returnPoms: readonly string[];
};

export type PomDefinition = {
  name: string;
  description?: string;
  children: readonly PomMemberManifest[];
  actions: readonly PomDefinitionAction[];
};

export type PomDefinitionsResult = {
  definitions: readonly PomDefinition[];
};

export function isJsonValue(
  value: unknown,
  ancestors: WeakSet<object> = new WeakSet()
): value is JsonValue {
  if (isJsonPrimitive(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  let valid: boolean;
  if (Array.isArray(value)) {
    valid = value.every((v) => isJsonValue(v, ancestors));
  } else {
    // Reject non-plain objects (DOM nodes, class instances, etc.)
    const proto = Object.getPrototypeOf(value);
    valid =
      (proto === Object.prototype || proto === null) &&
      Object.values(value).every((v) => isJsonValue(v, ancestors));
  }
  ancestors.delete(value);
  return valid;
}

/** A tool as an agent reads it, apart from its input schema. */
export type ToolDescriptor = {
  name: string;
  description: string;
};

/**
 * A registered Page Object's tool, as the registry describes it. It runs
 * through `ayme.tools.run`, as a Run, and its result is the `ActionResult`
 * of what changed on the page.
 */
export type RegisteredPomTool = {
  name: string;
  /** The description its author wrote; none when there is nothing to say. */
  authorDescription?: string;
  /**
   * Its Agent Description: the author's description, then the Page Objects
   * the page shows afterwards. None when it says nothing beyond its name and
   * schema.
   */
  agentDescription?: string;
  /**
   * The other Page Objects the action may return, which the page shows
   * afterwards, by class name.
   */
  returnPoms?: readonly string[];
  className: string;
  /** Whether its class declares a Page Object Root. */
  rooted: boolean;
  methodName: string;
  inputSchema: JsonSchema;
  /** Its parameters as agents read them. */
  parameters: readonly {
    name: string;
    optional: boolean;
    schema: JsonSchema;
  }[];
};
