import type { ToolResult } from "@ayme-dev/ayme";

import type { RunImage } from "./run";

type ImageResult = ToolResult<"screenshot">;

function isImageResult(value: unknown): value is ImageResult {
  if (typeof value !== "object" || value === null) return false;
  const image = value as Record<string, unknown>;
  return (
    image.type === "image" &&
    typeof image.subject === "string" &&
    (image.mimeType === "image/png" || image.mimeType === "image/jpeg") &&
    typeof image.width === "number" &&
    typeof image.height === "number" &&
    typeof image.data === "string"
  );
}

/**
 * The image a tool returned, such as a screenshot, as a run shows it, with
 * the file `ayme mcp` saved it to, if any.
 */
export function runImageOf(
  result: unknown,
  savedTo?: string
): RunImage | undefined {
  if (!isImageResult(result)) return undefined;
  const format = result.mimeType === "image/png" ? "PNG" : "JPEG";
  return {
    description: `Screenshot of ${result.subject}, ${result.width}×${result.height} ${format}`,
    src: `data:${result.mimeType};base64,${result.data}`,
    ...(savedTo === undefined ? {} : { savedTo }),
  };
}
