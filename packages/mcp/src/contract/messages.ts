import * as z from "zod/mini";

/**
 * The messages between the Ayme MCP server and the page client. Both sides
 * validate what they receive against these schemas.
 */

/**
 * A tool the page offers, as the page names and describes it, and whether
 * a call can run it now: a Page Object Tool is listed while its Page Object
 * is on the page, and `reason` says why an unavailable one cannot run, when
 * the page knows (ADR-0035). A Page Object Tool whose action says nothing
 * beyond its name and schema has no description, and MCP lists it without
 * one. `group` is where the tool comes from, as Ayme's runtime names it
 * (`pageObject`, `browser`, `custom`, `peek` or `agent`); the server decides
 * by it which tools it lists. A page from before it was sent sends none.
 */
export const PageToolSchema = z.object({
  name: z.string().check(z.minLength(1)),
  description: z.optional(z.string()),
  inputSchema: z.record(z.string(), z.unknown()),
  available: z.boolean(),
  reason: z.optional(z.string()),
  group: z.optional(z.string()),
});
export type PageTool = z.infer<typeof PageToolSchema>;

/**
 * Every tool the page or App Process offers right now. It sends the list on
 * every change.
 */
export const PageToolListSchema = z.array(PageToolSchema);

/**
 * The names of an App Process's tools the agent does not see, because an
 * App Process that connected earlier offers a tool with the same name. The
 * server sends the App Process the list at once and after every change to
 * it.
 */
export const HiddenToolListSchema = z.array(z.string().check(z.minLength(1)));

/** Why the agent does not see a hidden tool, as the agent and the App Process are told. */
export const HIDDEN_BECAUSE =
  "another App Process offers a tool with the same name";

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
 * A tool's result the agent gets as an image, such as a screenshot's: what it
 * shows, a bare file name for it, its format, its size in pixels and its
 * base64-encoded bytes. The server also writes it to a file under that name.
 * `@ayme-dev/ayme`'s `ImageResult` type has the same shape.
 */
export const ImageResultSchema = z.object({
  type: z.literal("image"),
  subject: z.string(),
  filename: z.string().check(z.minLength(1)),
  mimeType: z.enum(["image/png", "image/jpeg"]),
  width: z.number(),
  height: z.number(),
  data: z.string(),
});
export type ImageResult = z.infer<typeof ImageResultSchema>;

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
 * The server asks the page's Inspector contract (ADR-0049) to do something,
 * for an external Inspector window: a contract command or read by `method`,
 * with its `params`, or `subscribe` / `unsubscribe` for the window's events.
 * The server sends them in the order the window asked, and the page starts
 * each in that order. The server does not read the contract: it relays
 * plain data.
 */
export const InspectorRequestSchema = z.object({
  id: z.string().check(z.minLength(1)),
  method: z.string().check(z.minLength(1)),
  params: z.optional(z.unknown()),
});
export type InspectorRequest = z.infer<typeof InspectorRequestSchema>;

/** The page's answer to one Inspector request: the result, or why it failed. */
export const InspectorResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    id: z.string().check(z.minLength(1)),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    id: z.string().check(z.minLength(1)),
    ok: z.literal(false),
    error: z.string(),
  }),
]);
export type InspectorResponse = z.infer<typeof InspectorResponseSchema>;

/**
 * The version of these messages a page speaks, which it names in its hello.
 * The server refuses a page that speaks another. A change both sides
 * tolerate, such as an optional field, keeps it.
 */
export const PAIRING_CONTRACT = 1;

/**
 * The page introduces itself when its channel opens: the id its tab keeps
 * for this pairing across reloads and navigation, the document's URL, and
 * its `@ayme-dev/mcp` version and the pairing contract it speaks. A page
 * from before the contract was named sends neither.
 */
export const PageHelloSchema = z.object({
  tab: z.string().check(z.minLength(1)),
  url: z.string(),
  version: z.optional(z.string()),
  contract: z.optional(z.number()),
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
  /**
   * The folder the server saves a tool's images to, ending in a path
   * separator: an image named `filename` is saved as `imageFolder +
   * filename`.
   */
  imageFolder: z.optional(z.string().check(z.minLength(1))),
  /**
   * The name the agent's MCP client gave the server when it started it,
   * such as `claude-code`, for the Inspector to say which agent is
   * connected. None while the client has not introduced itself.
   */
  agent: z.optional(z.string().check(z.minLength(1))),
});
export type PageWelcome = z.infer<typeof PageWelcomeSchema>;

/**
 * The page started loading a new document, which ends its channel: the URL
 * that is loading, and whether it is a reload.
 */
export const PageNavigatingSchema = z.object({
  url: z.string(),
  reload: z.boolean(),
});
export type PageNavigating = z.infer<typeof PageNavigatingSchema>;

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

/**
 * The WebSocket close code the server ends a page's channel with when the
 * page speaks another pairing contract than the server. The close reason
 * names both versions. The page stops reconnecting.
 */
export const VERSION_GAP_CLOSE_CODE = 4003;
