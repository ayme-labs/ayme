// The rules of a screenshot call's input: which format, which file name, and
// what to capture. Pure, so they hold the same wherever the capture runs.
import { ToolInputError } from "./errors";

export type ImageType = "png" | "jpeg";

/** The screenshot's input, as its schema allows it. */
export type ScreenshotInput = {
  type?: ImageType;
  target?: string;
  fullPage?: boolean;
  filename?: string;
};

/** What a screenshot call captures, and the file name its image takes. */
export type ScreenshotRequest = {
  type: ImageType;
  filename: string;
  fullPage: boolean;
  target?: string;
};

const EXTENSION = /\.(png|jpe?g)$/i;

/** The format a file name's extension names, if it is one Ayme writes. */
function typeOfFilename(filename: string): ImageType | undefined {
  const extension = EXTENSION.exec(filename)?.[1]?.toLowerCase();
  if (extension === undefined) return undefined;
  return extension === "png" ? "png" : "jpeg";
}

function checkedFilename(filename: string): ImageType {
  if (/[/\\]|\.\./.test(filename))
    throw new ToolInputError(
      `The filename "${filename}" must be a bare file name, without "/", "\\" or "..".`
    );
  const type = typeOfFilename(filename);
  if (!type)
    throw new ToolInputError(
      `The filename "${filename}" must end in .png, .jpg or .jpeg.`
    );
  return type;
}

/** `page-<timestamp>.<type>`, with the ISO time made safe for a file name. */
function defaultFilename(type: ImageType, now: Date): string {
  return `page-${now.toISOString().replace(/[:.]/g, "-")}.${type}`;
}

/**
 * The capture a screenshot call asks for. The format is `type`, else the
 * filename's extension, else png; the two must agree when both are given.
 * Refuses a filename that is not a bare png or jpeg name, and `fullPage`
 * with a `target`.
 */
export function screenshotRequest(
  input: ScreenshotInput,
  now: Date
): ScreenshotRequest {
  if (input.fullPage === true && input.target !== undefined)
    throw new ToolInputError(
      "fullPage cannot be used with a target: capture the full page or one element."
    );
  const named =
    input.filename === undefined ? undefined : checkedFilename(input.filename);
  if (input.type !== undefined && named !== undefined && named !== input.type)
    throw new ToolInputError(
      `The filename "${input.filename}" is a ${named} name, but the type is ${input.type}. Give them the same format, or leave one out.`
    );
  const type = input.type ?? named ?? "png";
  return {
    type,
    filename: input.filename ?? defaultFilename(type, now),
    fullPage: input.fullPage === true,
    ...(input.target !== undefined ? { target: input.target } : {}),
  };
}
