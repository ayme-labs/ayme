type Nothing = Readonly<Record<never, never>>;

/**
 * What a Caller asks a Session. Each kind is one key, so a later kind is one
 * more member: the Inspector's requests join it.
 */
export type SessionRequest =
  /** `ayme close`: ends the Session, and closes a browser ayme opened. */
  | { readonly stop: Nothing }
  /** `ayme detach`: ends a Session on a joined browser, which keeps
   * running. */
  | { readonly detach: Nothing }
  /** `ayme page-objects`: the Page Object Tree of the Tab. */
  | { readonly pageObjects: OnTab }
  /** `ayme tools`: every Page Object Tool of the Tab, with its parameters. */
  | { readonly tools: OnTab }
  /** `ayme call`: a Run of the Page Object Tool `tool` with `input`, the
   * tool's input exactly as `ayme tools` prints its parameters. The
   * Page Object Id in `input` chooses the Tab. */
  | {
      readonly call: { readonly tool: string; readonly input: unknown } & OnTab;
    };

/** The Tab a request names by the URL its page shows, as a listing's first
 * line prints it; without one, the most recently active Tab. */
type OnTab = { readonly tab?: string };

/** What a Session answers: the text a command prints, and on success the
 * data `--json` prints with it. */
export type SessionAnswer =
  | { readonly ok: true; readonly text: string; readonly data?: unknown }
  | { readonly ok: false; readonly text: string };

/** How a Session ended: stopped or detached by a Caller, because its
 * browser went away, or before it ever started. */
export type SessionEnd =
  "stopped" | "detached" | "browser gone" | "start failed";
