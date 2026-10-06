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

/**
 * Every tool the page or App Process offers right now. It sends the list on
 * every change.
 */
export const PageToolListSchema = z.array(PageToolSchema);

/**
 * A reported tool the agent does not see, because a connection the server
 * keeps first offers a tool with the same name: the page, or an App Process
 * that reported it earlier.
 */
export const HiddenToolSchema = z.object({
  name: z.string().check(z.minLength(1)),
  offeredBy: z.enum(["page", "process"]),
});
export type HiddenTool = z.infer<typeof HiddenToolSchema>;

/**
 * The server's answer to a tool report: the reported tools the agent does
 * not see. Only an App Process's report gets them; a page's has none.
 */
export const ToolReportAnswerSchema = z.object({
  hidden: z.optional(z.array(HiddenToolSchema)),
});
export type ToolReportAnswer = z.infer<typeof ToolReportAnswerSchema>;

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
 * The page asks the server to run one of the App Processes' tools, as its
 * Inspector does. The server sends the call to the App Process that offers
 * it, and answers with that process's outcome. The server sends the page
 * the App Processes' tools as a `PageToolListSchema` list, at once and
 * after every change.
 */
export const ProcessToolCallSchema = z.object({
  name: z.string().check(z.minLength(1)),
  input: z.unknown(),
});
export type ProcessToolCall = z.infer<typeof ProcessToolCallSchema>;

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
 * An App Process introduces itself when its channel opens: the id it keeps
 * for this connection across reconnects. It has no URL and never reports a
 * navigation.
 */
export const ProcessHelloSchema = z.object({
  process: z.string().check(z.minLength(1)),
});
export type ProcessHello = z.infer<typeof ProcessHelloSchema>;

/** What opens a channel: a page's hello or an App Process's. */
export const HelloSchema = z.union([PageHelloSchema, ProcessHelloSchema]);
export type Hello = z.infer<typeof HelloSchema>;

/**
 * The server's answer to a hello. A page or App Process that paired without
 * a token, by auto-pairing, gets the server's token, so it reconnects with
 * the full pairing, as a connect link gives it.
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
