import type { JsonValue, PomDefinition, ToolDescriptor } from "../../shared";
import { getPageStateSession } from "../../page-state/infrastructure";
import { type AriaRef, type PageState } from "../../page-state/domain";
import { type PageStateSession } from "../../page-state/application";
import { getPomDefinitions } from "../../page-objects/infrastructure";
import { renderPomDefinitions } from "../../page-objects/domain";
import type { Cursor } from "../../page-state/domain";
import type { RunContext } from "../../runs/application";
import type { PageContextPayload } from "../domain/toolTypes";

export type PageContext = {
  readonly structure: string;
  readonly pomDefinitions: readonly PomDefinition[];
  resolve(...refs: AriaRef[]): ReturnType<PageState["resolve"]>;
};

export const getPageContextTool = {
  name: "snapshot",
  description:
    "Return the current live structural page state together with compact POM capability definitions known to Ayme. `structure` is the current page snapshot. Each definition starts with its class name and an optional // description. A bare member is a Locator; member: ChildPom is a child POM; [] marks collections; and action(args): this | OtherPom is an action with possible next POMs. Action comments are authored descriptions, and this means the current POM. Definitions can include POMs or actions that are not currently visible or callable; action return POMs describe possible next surfaces, not guarantees. The client's currently registered tool schemas remain authoritative for what can be called now.",
  inputSchema: {
    type: "object",
    properties: {
      names: {
        type: "array",
        items: { type: "string" },
        description:
          "Page Object class names whose definitions to include in pomDefinitions. Omitted or empty: every known one. The structure is always the whole page.",
      },
    },
    required: [],
    additionalProperties: false,
  } as const,
  /** Reads the Run's Document for its Caller, whose cursor moves to it. */
  execute: (input: unknown, context: RunContext) => snapshotFor(input, context),
} satisfies ToolDescriptor & {
  inputSchema: object;
  execute(input: unknown, context: RunContext): Promise<JsonValue>;
};

async function snapshotFor(
  input: unknown,
  { pageStateSession, cursor }: RunContext
): Promise<JsonValue> {
  const context = await pageContextFor(
    pageStateSession,
    cursor,
    (input as { names?: string[] }).names ?? []
  );
  const payload: PageContextPayload = {
    structure: context.structure,
    pomDefinitions: renderPomDefinitions(context.pomDefinitions),
  };
  return JSON.parse(JSON.stringify(payload)) as JsonValue;
}

/** The page context `cursor`'s reader receives; its cursor moves to the capture. */
export async function getPageContextForDocument(
  currentDocument: Document,
  cursor: Cursor,
  ...names: readonly string[]
): Promise<PageContext> {
  return pageContextFor(getPageStateSession(currentDocument), cursor, names);
}

async function pageContextFor(
  pageStateSession: PageStateSession,
  cursor: Cursor,
  names: readonly string[]
): Promise<PageContext> {
  const pageState = await pageStateSession.getPageState(cursor);
  return Object.freeze({
    structure: pageState.text,
    pomDefinitions: getPomDefinitions(...names).definitions,
    resolve: pageState.resolve,
  });
}

/**
 * The POM definitions for `names` (every known one when empty), as the text
 * `snapshot` returns in `pomDefinitions`. Captures no page state.
 */
export function getPomDefinitionText(...names: readonly string[]): string {
  return renderPomDefinitions(getPomDefinitions(...names).definitions);
}
