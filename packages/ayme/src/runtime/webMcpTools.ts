// The session's tools as WebMCP publishes them (ADR-0030): the screen is
// described through its Page Objects, not through structural snapshots and
// diffs. `page_objects` reads the Page Object Screen; an action's result
// carries how that screen changed. The Agent Connection hands `ayme mcp` the
// same tools with the same results when its `tools` option asks for the
// Page Object Tools alone; otherwise `ayme mcp`, like the Goal Loop, reads
// the session's own results.
import {
  renderPomScreen,
  renderScreenChanges,
  requiredDescription,
  type ScreenObject,
} from "../page-objects/domain";
import { ACTION_RESULT_NOTE, type ActionFailure } from "../page-state/domain";
import type { JsonSchema, JsonValue, ToolInfo } from "../shared";
import { waitForCompletion, type CompletionPage } from "./waitForCompletion";

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
  inputSchema: JsonSchema;
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
  /** The page, for the wait after an action. */
  page(): CompletionPage;
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

function withInstanceRef(schema: JsonSchema): JsonSchema {
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
 * The session's Page Object Tools and `page_objects`, for an agent whose
 * browser tool does the rest: `page_objects` answers the Page Object Screen
 * as text, and an action's result is reshaped as `WebMcpActionResult`,
 * after the wait Playwright's tools take after an action
 * (`waitForCompletion`), so its `changes` show the screen the action led
 * to, a Page Object that appeared in full. A
 * failed action throws its error without the Change Record the session left
 * on it. The Browser Tools, Custom Tools, `snapshot`, `goal` and the Peek
 * Tools are not listed. WebMCP publication and the Agent Connection's Page
 * Object Tools share it, each with its own Caller in `session.run`.
 */
export function pageObjectToolSource(session: WebMcpSession) {
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
        return renderPomScreen(await session.readScreen());
      const before = await session.readScreen().catch(() => undefined);
      const url = session.url();
      // The action and the session's own settle wait, then Playwright's
      // wait around both, so the screen read after it is the one the
      // action led to. A full page load ends the document: no wait then.
      const result = await waitForCompletion(
        session.page(),
        () =>
          session.run(name, input).catch((error: unknown) => {
            throw withoutChangeRecord(error);
          }),
        (answer) => isActionResult(answer) && answer.loading !== undefined
      );
      if (!isActionResult(result)) return result;
      return publishedResult(session, result, before, url);
    },
  };
}

/**
 * The session's tools as `@ayme-dev/webmcp` reaches them: those of
 * `pageObjectToolSource`, with the text `page_objects` answers as an MCP
 * text result, which is what a WebMCP driver hands on as text.
 */
export function webMcpToolSource(session: WebMcpSession) {
  const source = pageObjectToolSource(session);
  return {
    ...source,
    async run(name: string, input: unknown): Promise<unknown> {
      const result = await source.run(name, input);
      return name === PAGE_OBJECTS_TOOL
        ? { content: [{ type: "text", text: result }] }
        : result;
    },
  };
}

/**
 * A failed action's error without the Change Record the session attached to
 * it: the same error, since the Run log has recorded the failure by now.
 */
function withoutChangeRecord(error: unknown): unknown {
  if (error instanceof Error)
    for (const part of ["page_changed", "changes_before", "changes"] as const)
      delete (error as Partial<ActionFailure>)[part];
  return error;
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
