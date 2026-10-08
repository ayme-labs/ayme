// screenshot: the Browser Tool that captures the page, or one element, as an
// image, as Playwright MCP's browser_take_screenshot does. playwright-lite
// renders it from the DOM. It reads and never acts, so it records no
// Structural Action. Published only: the Goal Loop never offers it.
import type { JsonSchema } from "./contracts";
import {
  locatorOf,
  requireCurrentDocument,
  resolveElementTarget,
  validatedToolInput,
  type PublishedElementTool,
} from "./elementTools";
import { INSPECTOR_HOST_SELECTOR } from "./pageState";
import { requireAymeRuntimePage } from "./registry";
import {
  screenshotRequest,
  type ImageType,
  type ScreenshotInput,
} from "./screenshotRequest";
import type { ToolResult } from "./toolTypes";

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["png", "jpeg"],
      description: "Image format. Omitted: the filename's extension, else png.",
    },
    target: {
      type: "string",
      description:
        "A Structural Ref from the page snapshot, or a selector that matches exactly one element, to capture that element alone. Omitted: the viewport.",
    },
    fullPage: {
      type: "boolean",
      description:
        "Capture the whole scrollable page instead of the viewport; false when omitted. Cannot be used with a target.",
    },
    filename: {
      type: "string",
      description:
        "Bare file name for the image, ending in .png, .jpg or .jpeg. Omitted: page-<timestamp>.<type>.",
    },
  },
  additionalProperties: false,
};

// The Inspector is not part of the page: it is hidden from the capture,
// unless the page dogfoods it.
const HIDE_INSPECTOR = `${INSPECTOR_HOST_SELECTOR}{visibility:hidden}`;

const MIME_TYPES = {
  png: "image/png",
  jpeg: "image/jpeg",
} as const satisfies Record<ImageType, string>;

function base64(bytes: Uint8Array): string {
  let binary = "";
  // In chunks, as spreading a large array into one call overflows the stack.
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

/** The image's size in pixels, as the browser decodes it. */
async function sizeOf(bytes: Uint8Array, mimeType: string) {
  const bitmap = await createImageBitmap(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType })
  );
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Package-internal: the screenshot Browser Tool, published only. */
export const screenshotTool: PublishedElementTool = {
  name: "screenshot",
  description:
    "Take a screenshot of the viewport, the full page or one element. To act on the page, use the snapshot's Structural Refs, not the image.",
  inputSchema,
  execute: async (input) => {
    const request = screenshotRequest(
      validatedToolInput(inputSchema, input) as ScreenshotInput,
      new Date()
    );
    const options = {
      type: request.type,
      // As Playwright MCP captures: CSS pixels, and jpeg at quality 90.
      scale: "css" as const,
      ...(request.type === "jpeg" ? { quality: 90 } : {}),
      style: HIDE_INSPECTOR,
    };
    let bytes: Uint8Array;
    let subject: string;
    if (request.target !== undefined) {
      const target = await resolveElementTarget(
        { label: "take a screenshot of", targetField: "target" },
        request.target,
        requireCurrentDocument()
      );
      bytes = await (await locatorOf(target)).screenshot(options);
      subject = `element ${request.target}`;
    } else {
      bytes = await requireAymeRuntimePage().screenshot({
        ...options,
        fullPage: request.fullPage,
      });
      subject = request.fullPage ? "the full page" : "the viewport";
    }
    const mimeType = MIME_TYPES[request.type];
    const result: ToolResult<"screenshot"> = {
      type: "image",
      subject,
      filename: request.filename,
      mimeType,
      ...(await sizeOf(bytes, mimeType)),
      data: base64(bytes),
    };
    return result;
  },
};
