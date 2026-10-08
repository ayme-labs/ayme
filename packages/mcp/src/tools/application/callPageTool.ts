import type { AgentConnection } from "../../connection";
import {
  errorText,
  imageOf,
  imageToolResult,
  notConnectedResult,
  pageToolResult,
  RESTARTED_NOTE,
  type SavedImage,
  type ToolResult,
} from "../domain/toolResult";

/** Writes an image's base64 bytes to a file named `filename`; resolves with its path. */
export type SaveImage = (filename: string, data: string) => Promise<string>;

/**
 * Runs the tool `name` of the page or App Process that offers it, as an MCP
 * result. A name no connection offers gets `unknown(name)` while a page or
 * App Process is paired; otherwise, or when the connection leaves before
 * the call goes out, it answers that no page is connected, since the name
 * may be a page tool the agent listed before. An image the tool returns is
 * saved with `saveImage` too. The agent's first result from an App Process
 * that took the place of one it called before ends with `RESTARTED_NOTE`.
 */
export async function callPageTool(
  connection: AgentConnection,
  name: string,
  input: unknown,
  unknown: (name: string) => ToolResult,
  saveImage: SaveImage
): Promise<ToolResult> {
  if (!connection.offers(name))
    return connection.connected ? unknown(name) : notConnectedResult();
  const restarted = connection.takeRestarted(name);
  const result = await callOffered(connection, name, input, saveImage);
  if (!restarted) return result;
  return {
    ...result,
    content: [...result.content, { type: "text", text: RESTARTED_NOTE }],
  };
}

async function callOffered(
  connection: AgentConnection,
  name: string,
  input: unknown,
  saveImage: SaveImage
): Promise<ToolResult> {
  let outcome;
  try {
    outcome = await connection.call(name, input);
  } catch {
    // The connection left between the check and the call.
    return notConnectedResult();
  }
  const image = imageOf(outcome);
  if (!image) return pageToolResult(outcome);
  let saved: SavedImage;
  try {
    saved = { path: await saveImage(image.filename, image.data) };
  } catch (error) {
    saved = { error: errorText(error) };
  }
  return imageToolResult(image, saved);
}
