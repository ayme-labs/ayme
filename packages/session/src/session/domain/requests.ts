/**
 * What a Caller asks a Session. Each kind is one key, so a later kind is one
 * more member: the Page Object, tool, call and Inspector requests join it.
 */
export type SessionRequest = { readonly stop: Readonly<Record<never, never>> };

/** What a Session answers: the text a command prints, and on success the
 * data `--json` prints with it. */
export type SessionAnswer =
  | { readonly ok: true; readonly text: string; readonly data?: unknown }
  | { readonly ok: false; readonly text: string };

/** How a Session ended: stopped by a Caller, because its browser went away,
 * or before it ever started. */
export type SessionEnd = "stopped" | "browser gone" | "start failed";
