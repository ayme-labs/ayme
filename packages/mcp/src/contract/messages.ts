import * as z from "zod/mini";

/**
 * The messages between the Ayme MCP server and the page client. Both sides
 * validate what they receive against these schemas.
 */

/** A tool the page offers, as the page names and describes it. */
export const PageToolSchema = z.object({
  name: z.string().check(z.minLength(1)),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type PageTool = z.infer<typeof PageToolSchema>;

/** Every tool the page offers right now. The page sends it on every change. */
export const PageToolListSchema = z.array(PageToolSchema);

/** The server asks the page to run one of its tools. */
export const ToolCallSchema = z.object({
  callId: z.string().check(z.minLength(1)),
  name: z.string().check(z.minLength(1)),
  input: z.unknown(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** The page's answer to one call: the tool's result, or why it failed. */
export const ToolCallOutcomeSchema = z.discriminatedUnion("ok", [
  z.object({
    callId: z.string().check(z.minLength(1)),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    callId: z.string().check(z.minLength(1)),
    ok: z.literal(false),
    error: z.string(),
  }),
]);
export type ToolCallOutcome = z.infer<typeof ToolCallOutcomeSchema>;

/**
 * The page introduces itself when its channel opens: the id its tab keeps
 * for this pairing across reloads and navigation, and the document's URL.
 */
export const PageHelloSchema = z.object({
  tab: z.string().check(z.minLength(1)),
  url: z.string(),
});
export type PageHello = z.infer<typeof PageHelloSchema>;

/**
 * The server's answer to the page's hello. A page that paired without a
 * token, by auto-pairing, gets the server's token, so the tab keeps and
 * reconnects with the full pairing, as a connect link gives it.
 */
export const PageWelcomeSchema = z.object({
  token: z.optional(z.string().check(z.minLength(1))),
});
export type PageWelcome = z.infer<typeof PageWelcomeSchema>;

/**
 * The page started loading a new document, which ends its channel: the URL
 * that is loading, and whether it is a reload.
 */
export const PageLeavingSchema = z.object({
  url: z.string(),
  reload: z.boolean(),
});
export type PageLeaving = z.infer<typeof PageLeavingSchema>;

/**
 * The WebSocket close code the server ends a page's channel with when
 * another tab paired in its place. The page stops reconnecting and forgets
 * its pairing.
 */
export const DISCONNECTED_CLOSE_CODE = 4001;

/**
 * The WebSocket close code the server ends a localhost page's channel with
 * when the page presents a token that is not this server's, as when another
 * server took the port of the one the tab paired with. The page forgets its
 * pairing.
 */
export const UNKNOWN_PAIRING_CLOSE_CODE = 4002;
