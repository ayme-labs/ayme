// The session's tools as WebMCP publishes them (ADR-0030): the screen is
// described through its Page Objects, not through structural snapshots and
// diffs. `page_objects` reads the Page Object Screen; an action's result
// carries how that screen changed. `ayme mcp` and the Goal Loop read the
// session's own results.
import {
  renderPomScreen,
  renderScreenChanges,
  requiredDescription,
  type ScreenObject,
} from "../page-objects/domain";
import { ACTION_RESULT_NOTE } from "../page-state/domain";
import type { JsonValue, ToolInfo } from "../shared";

/** The read-only tool WebMCP adds: the Page Object Screen. */
export const PAGE_OBJECTS_TOOL = "page_objects";

const PAGE_OBJECTS_DESCRIPTION =
  "Read the Page Objects on the page now, nested as they nest: each declared child as its accessibility subtree, and each instance that rooted tools act on with its ref (po<n>).";

const INSTANCE_REF_DESCRIPTION =
  "The instance's ref, po<n>, as page_objects shows it.";

/** A tool as `@ayme-dev/webmcp` lists it. */
export type WebMcpToolInfo = Readonly<{
  name: string;
  description: string;
  inputSchema: object;
  group: string;
  available: boolean;
}>;

/** What WebMCP publication reads of the session. */
export type WebMcpSession = {
  list(): readonly ToolInfo[];
  subscribe(listener: () => void): () => void;
  run(name: string, input: unknown): Promise<unknown>;
  /** The Page Object Screen now, read in its own turn on the page's queue. */
  readScreen(): Promise<ScreenObject[]>;
  /** The page's URL now. */
  url(): string;
};

/** An action's result as WebMCP publishes it. */
export type WebMcpActionResult = {
  settled: boolean;
  result?: JsonValue;
  /** The URL the page moved to, when the action changed it. */
  url?: string;
  /** The URL a full page load started for. */
  loading?: string;
  /** How the Page Object Screen changed; absent when it did not. */
  changes?: string;
};

type SessionActionResult = {
  settled: boolean;
  page_changed: boolean;
  result?: JsonValue;
  loading?: string;
};

const isActionResult = (value: unknown): value is SessionActionResult =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { settled?: unknown }).settled === "boolean" &&
  typeof (value as { page_changed?: unknown }).page_changed === "boolean";

/**
 * A tool's description and schema as WebMCP publishes them: without the
 * sentence on the Change Record, and a rooted Page Object Tool's `ref`
 * asking for an Instance Ref.
 */
export function publishedInfo(tool: ToolInfo): WebMcpToolInfo {
  const description = requiredDescription({
    name: tool.name,
    agentDescription: tool.agentDescription,
  })
    .replace(` ${ACTION_RESULT_NOTE}`, "")
    .replace(ACTION_RESULT_NOTE, "");
  return {
    name: tool.name,
    description,
    inputSchema:
      tool.group === "pageObject"
        ? withInstanceRef(tool.inputSchema)
        : tool.inputSchema,
    group: tool.group,
    available: tool.available,
  };
}

function withInstanceRef(schema: object): object {
  const properties = (schema as { properties?: Record<string, object> })
    .properties;
  if (!properties?.ref) return schema;
  return {
    ...schema,
    properties: {
      ...properties,
      ref: { ...properties.ref, description: INSTANCE_REF_DESCRIPTION },
    },
  };
}

const pageObjectsTool: WebMcpToolInfo = {
  name: PAGE_OBJECTS_TOOL,
  description: PAGE_OBJECTS_DESCRIPTION,
  inputSchema: { type: "object", properties: {} },
  group: "agent",
  available: true,
};

/**
 * The session's tools as `@ayme-dev/webmcp` reaches them: its Page Object
 * Tools and `page_objects`, an action's result reshaped as
 * `WebMcpActionResult`. The Browser Tools, Custom Tools, `snapshot`, `goal`
 * and the Peek Tools are not published.
 */
export function webMcpToolSource(session: WebMcpSession) {
  return {
    list: (): readonly WebMcpToolInfo[] => [
      ...session
        .list()
        .filter(({ group }) => group === "pageObject")
        .map(publishedInfo),
      pageObjectsTool,
    ],
    subscribe: (listener: () => void) => session.subscribe(listener),
    async run(name: string, input: unknown): Promise<unknown> {
      if (name === PAGE_OBJECTS_TOOL)
        return {
          content: [
            { type: "text", text: renderPomScreen(await session.readScreen()) },
          ],
        };
      const before = await session.readScreen().catch(() => undefined);
      const url = session.url();
      const result = await session.run(name, input);
      if (!isActionResult(result)) return result;
      return publishedResult(session, result, before, url);
    },
  };
}

async function publishedResult(
  session: WebMcpSession,
  { settled, result, loading }: SessionActionResult,
  before: readonly ScreenObject[] | undefined,
  url: string
): Promise<WebMcpActionResult> {
  const published: WebMcpActionResult = {
    settled,
    ...(result === undefined ? {} : { result }),
  };
  // A full load ends this document: its screen is not read again.
  if (loading !== undefined) return { ...published, loading };
  const now = session.url();
  if (now !== url) published.url = now;
  const after = await session.readScreen().catch(() => undefined);
  const changes = before && after && renderScreenChanges(before, after);
  if (changes) published.changes = changes;
  return published;
}
