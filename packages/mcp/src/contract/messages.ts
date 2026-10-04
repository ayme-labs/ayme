import { z } from "zod";

/**
 * The messages between the Ayme MCP server and the page client. Both sides
 * validate what they receive against these schemas.
 */

/** A tool the page offers, as the page names and describes it. */
export const PageToolSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type PageTool = z.infer<typeof PageToolSchema>;

/** Every tool the page offers right now. The page sends it on every change. */
export const PageToolListSchema = z.array(PageToolSchema);

/** The server asks the page to run one of its tools. */
export const ToolCallSchema = z.object({
  callId: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** The page's answer to one call: the tool's result, or why it failed. */
export const ToolCallOutcomeSchema = z.discriminatedUnion("ok", [
  z.object({
    callId: z.string().min(1),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    callId: z.string().min(1),
    ok: z.literal(false),
    error: z.string(),
  }),
]);
export type ToolCallOutcome = z.infer<typeof ToolCallOutcomeSchema>;
