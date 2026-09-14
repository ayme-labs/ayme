import type { ModelContextTool } from "@mcp-b/webmcp-types";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonSchema = {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
  items?: JsonSchema;
  enum?: readonly JsonPrimitive[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  minimum?: number;
};

export type ToolParameter = {
  name: string;
  optional: boolean;
  schema: JsonSchema;
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
};

export type ToolManifest = {
  methodName: string;
  toolName: string;
  description: string;
  authoredDescription?: string;
  inputSchema: JsonSchema;
  parameters: readonly ToolParameter[];
  returnPoms?: readonly string[];
};

export type PomManifest = {
  className: string;
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

export type RegisteredPomTool = ModelContextTool<
  Record<string, unknown>,
  JsonValue
> & {
  pomId: string;
  componentClassName?: string;
  methodName: string;
  inputSchema: JsonSchema;
  parameters: readonly ToolParameter[];
  execute(args: unknown): Promise<JsonValue>;
};
