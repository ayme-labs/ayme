import * as z from "zod/mini";

/**
 * What an external Inspector window and the server say to each other over
 * the window's WebSocket. The window's transport (`@ayme-dev/inspector`'s
 * external build) writes and reads the same frames; both ends carry the
 * Inspector contract's plain data and the server reads none of it but a
 * pick's id, to cancel the picks of a window that leaves.
 */

/** A window's request: a contract command or read by `method`, or `subscribe` / `unsubscribe` for events. */
export const WindowRequestSchema = z.object({
  id: z.union([z.string(), z.number()]),
  method: z.string().check(z.minLength(1)),
  params: z.optional(z.unknown()),
});
export type WindowRequest = z.infer<typeof WindowRequestSchema>;

/**
 * What the server sends a window: the answer to a request (a result or an
 * error), an event of the page's contract, or a reset, which says the page
 * it follows is a new document whose revisions start again.
 */
export type InspectorReply =
  | { id: string | number; result: unknown }
  | { id: string | number; error: string }
  | { event: unknown }
  | { reset: true };
