import type { Page } from "@playwright/test";
import type { ModelContextTool } from "@mcp-b/webmcp-types";
import type { JsonValue } from "./contracts";
import {
  resolvePageStateRefs,
  type AriaRef,
  type RefResolution,
} from "./pageState";
import { requireAymeRuntimePage } from "./registry";

type RefInput = { ref: AriaRef };
type FillRefInput = RefInput & { value: string };

export const clickPageStateRefTool = {
  name: "click_page_state_ref",
  description:
    "Click a real element ref from get_page_context. The ref is resolved against a fresh capture before the action.",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
    additionalProperties: false,
  } as const,
  execute: async (input: unknown): Promise<JsonValue> => {
    const ref = readRef(input);
    await createRefInteractions(requireAymeRuntimePage()).click(ref);
    return { ok: true };
  },
} satisfies ModelContextTool<RefInput, JsonValue>;

export const fillPageStateRefTool = {
  name: "fill_page_state_ref",
  description:
    "Fill a real editable element ref from get_page_context with text. The ref is resolved against a fresh capture before the action.",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string" }, value: { type: "string" } },
    required: ["ref", "value"],
    additionalProperties: false,
  } as const,
  execute: async (input: unknown): Promise<JsonValue> => {
    const { ref, value } = readFillInput(input);
    await createRefInteractions(requireAymeRuntimePage()).fill(ref, value);
    return { ok: true };
  },
} satisfies ModelContextTool<FillRefInput, JsonValue>;

function readRef(input: unknown): AriaRef {
  if (
    typeof input === "object" &&
    input !== null &&
    "ref" in input &&
    typeof input.ref === "string"
  )
    return input.ref;
  throw new Error("A Structural Ref string is required.");
}

function readFillInput(input: unknown): FillRefInput {
  if (
    typeof input === "object" &&
    input !== null &&
    "ref" in input &&
    typeof input.ref === "string" &&
    "value" in input &&
    typeof input.value === "string"
  )
    return { ref: input.ref, value: input.value };
  throw new Error("A Structural Ref and string value are required.");
}

export type RefInteractions = Readonly<{
  click(ref: AriaRef): Promise<void>;
  fill(ref: AriaRef, value: string): Promise<void>;
}>;

/** Build action methods for Structural Refs using the configured browser Page. */
export function createRefInteractions(
  page: Page,
  currentDocument: Document = requireCurrentDocument()
): RefInteractions {
  return {
    click: (ref) => performAction(page, currentDocument, "click", ref),
    fill: (ref, value) =>
      performAction(page, currentDocument, "fill", ref, value),
  };
}

async function performAction(
  page: Page,
  currentDocument: Document,
  action: "click" | "fill",
  requestedRef: AriaRef,
  value?: string
): Promise<void> {
  const resolution = (
    await resolvePageStateRefs(currentDocument, requestedRef)
  )[0]!;

  if (requestedRef.startsWith("s_"))
    throw new Error(
      `Cannot ${action} ref "${requestedRef}": synthetic observation-only ref.`
    );

  if (resolution.status === "unresolved")
    throw unresolvedRefError(action, resolution);

  if (resolution.node.ref.startsWith("s_"))
    throw new Error(
      `Cannot ${action} ref "${requestedRef}": synthetic observation-only ref.`
    );

  // Page.ariaSnapshot updates Playwright-lite's public aria-ref lookup. The
  // action must use the ref returned by the current Page State resolution.
  await page.ariaSnapshot({ mode: "ai" });
  if (action === "click") await page.click(`aria-ref=${resolution.node.ref}`);
  else await page.fill(`aria-ref=${resolution.node.ref}`, value!);
}

function unresolvedRefError(
  action: "click" | "fill",
  resolution: Extract<RefResolution, { status: "unresolved" }>
): Error {
  return new Error(
    `Cannot ${action} ref "${resolution.requestedRef}": ${resolution.reason}.`
  );
}

function requireCurrentDocument(): Document {
  if (typeof document === "undefined")
    throw new Error("Structural Ref interactions require a browser Document.");
  return document;
}
