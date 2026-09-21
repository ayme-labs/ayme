import {
  AriaRefSchema,
  SETTLED_PAGE_DEADLINE_MS,
  SETTLED_PAGE_QUIET_MS,
  structuralPageChanged,
  waitForSettled,
} from "@ayme-dev/core/structural-observation";
import type { Page } from "@playwright/test";
import type { ModelContextTool } from "@mcp-b/webmcp-types";
import type { JsonValue } from "./contracts";
import { browserMonotonicClock } from "./browserMonotonicClock";
import { getBrowserPageActivitySource } from "./pageActivitySource";
import {
  getPageStateCaptureForDocument,
  resolvePageStateRefsForAction,
  type AriaRef,
  type RefResolution,
} from "./pageState";
import { requireAymeRuntimePage } from "./registry";

type RefInput = { ref: AriaRef };
type FillRefInput = RefInput & { value: string };

export type RefActionResult = {
  page_changed: boolean;
  settled: boolean;
};

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
    return createRefInteractions(requireAymeRuntimePage()).click(ref);
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
    return createRefInteractions(requireAymeRuntimePage()).fill(ref, value);
  },
} satisfies ModelContextTool<FillRefInput, JsonValue>;

function readRef(input: unknown): AriaRef {
  if (
    typeof input === "object" &&
    input !== null &&
    "ref" in input &&
    typeof input.ref === "string"
  )
    return AriaRefSchema.parse(input.ref);
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
    return { ref: AriaRefSchema.parse(input.ref), value: input.value };
  throw new Error("A Structural Ref and string value are required.");
}

export type RefInteractions = Readonly<{
  click(ref: AriaRef): Promise<RefActionResult>;
  fill(ref: AriaRef, value: string): Promise<RefActionResult>;
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
): Promise<RefActionResult> {
  const { decisionTree, resolutions } = await resolvePageStateRefsForAction(
    currentDocument,
    requestedRef
  );
  const resolution = resolutions[0]!;

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

  const { stable } = await waitForSettled({
    activity: getBrowserPageActivitySource(currentDocument),
    clock: browserMonotonicClock,
    quietMs: SETTLED_PAGE_QUIET_MS,
    deadlineMs: SETTLED_PAGE_DEADLINE_MS,
  });

  const afterCapture = await getPageStateCaptureForDocument(currentDocument);

  return {
    page_changed: structuralPageChanged(decisionTree, afterCapture.tree),
    settled: stable,
  };
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
