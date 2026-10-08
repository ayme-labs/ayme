import {
  ImageResultSchema,
  type ImageResult,
  type PageTool,
  type ToolCallOutcome,
} from "../../contract";

/** An MCP tool result. */
export type ToolResult = {
  content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[];
  isError?: boolean;
};

/**
 * A thrown error as the text an agent reads: its full message, prefixed with
 * its name unless that is plain "Error", as WebMCP publication reports it.
 */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (!error.name || error.name === "Error") return error.message;
  return `${error.name}: ${error.message}`;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * A page tool's outcome as an MCP result: a text result passes through, and
 * any other value is its JSON text. A failure is an `isError` result.
 */
export function pageToolResult(outcome: ToolCallOutcome): ToolResult {
  if (!outcome.ok) return errorResult(outcome.error);
  const { result } = outcome;
  if (result === undefined || result === null) return textResult("null");
  if (typeof result === "string") return textResult(result);
  return textResult(JSON.stringify(result));
}

/** The image a page tool returned, such as a screenshot, if it returned one. */
export function imageOf(outcome: ToolCallOutcome): ImageResult | undefined {
  if (!outcome.ok) return undefined;
  const parsed = ImageResultSchema.safeParse(outcome.result);
  return parsed.success ? parsed.data : undefined;
}

/** Where an image's file was written, or why it could not be. */
export type SavedImage = { path: string } | { error: string };

// Larger images are not returned inline, as agents' models refuse them.
const MAX_INLINE_SIDE = 8000;
const MAX_INLINE_BYTES = 5 * 1024 * 1024;

/** How many bytes a base64 string decodes to. */
function decodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/** Why an image is too large to return inline, if it is. */
function tooLargeToInline(image: ImageResult): string | undefined {
  if (image.width > MAX_INLINE_SIDE || image.height > MAX_INLINE_SIDE)
    return `it is over ${MAX_INLINE_SIDE} pixels on a side`;
  if (decodedBytes(image.data) > MAX_INLINE_BYTES) return "it is over 5 MB";
  return undefined;
}

/**
 * An image as an MCP result: the image, then a line naming what it shows and
 * the file it was saved to. An image too large to return inline comes back
 * as that line alone, saying why; it fails if its file could not be written
 * either.
 */
export function imageToolResult(
  image: ImageResult,
  saved: SavedImage
): ToolResult {
  const format = image.mimeType === "image/png" ? "PNG" : "JPEG";
  const shows = `Screenshot of ${image.subject}, ${image.width}×${image.height} ${format}`;
  const line =
    "path" in saved
      ? `${shows}, saved to ${saved.path}.`
      : `${shows}. It could not be saved to a file: ${saved.error}.`;
  const tooLarge = tooLargeToInline(image);
  if (tooLarge)
    return {
      content: [
        { type: "text", text: `${line} Not returned inline: ${tooLarge}.` },
      ],
      ...("error" in saved ? { isError: true } : {}),
    };
  return {
    content: [
      { type: "image", data: image.data, mimeType: image.mimeType },
      { type: "text", text: line },
    ],
  };
}

/** The answer of a page tool or fallback tool while no page is paired. */
export function notConnectedResult(): ToolResult {
  return errorResult(
    "No page is connected. Call ayme_connect with the app's URL and open the link it returns, in your browser tool or in the developer's browser."
  );
}

/** A page tool as an MCP tool listing shows it. */
export function mcpPageTool({ name, description, inputSchema }: PageTool) {
  return {
    name,
    description,
    inputSchema: { ...inputSchema, type: "object" as const },
  };
}
