// The Page Object Tools as the two agent channels, WebMCP publication and
// `ayme mcp`, take them and their answers: both build their source with
// `pageObjectToolSource`, each over its own Caller, so a tool and its answer
// cannot differ between them. `ayme.tools.run` keeps answering the full
// record, which application code, the Inspector and the Goal Loop read.
import {
  renderPageObjectTreeChanges,
  type PageObjectTreeRead,
} from "../page-objects/domain";
import type { ActionFailure, ActionResult } from "../page-state/domain";
import { pageObjectsTool } from "../tools/application";
import type { JsonValue, ToolInfo } from "../shared";

/** What the source reads of the session, its calls made by one Caller. */
export type PageObjectToolSession = {
  list(): readonly ToolInfo[];
  subscribe(listener: () => void): () => void;
  /** Runs the tool `name` in a turn of its own on the page's queue. */
  run(name: string, input: unknown): Promise<unknown>;
  /**
   * Runs `turn` in one turn on the page's queue, so no other Run acts on the
   * page between what `turn` reads and runs.
   */
  inTurn<T>(turn: (page: PageObjectToolTurn) => Promise<T>): Promise<T>;
};

/** The page as one turn on its queue reaches it. */
export type PageObjectToolTurn = {
  /** Runs the tool `name` inside this turn, as a top-level Run that does not queue. */
  run(name: string, input: unknown): Promise<unknown>;
  /** The Page Object Tree now, and the capture of the page it was read from. */
  readPageObjectTree(): Promise<PageObjectTreeRead>;
  /** The page's URL now. */
  url(): string;
  /**
   * Spike: where the session outlives a full load, as a Node host's does, a
   * watch for loads from now on. The browser runtime's session ends with its
   * document and offers none.
   */
  watchLoads?(): LoadWatch;
};

/** Spike: the loads of the page from the start of a watch. */
export type LoadWatch = {
  /**
   * Resolves once a document a full load brought has settled, saying
   * whether it went quiet before the Settled Page deadline; with
   * `undefined` when none came before the deadline.
   */
  loaded(): Promise<{ settled: boolean } | undefined>;
  /** Ends the watch. */
  stop(): void;
};

/** A Page Object Tool's answer to an agent. */
export type PageObjectToolAnswer = {
  /** Whether the page settled after the action. */
  settled: boolean;
  /** What the Page Object Action returned, when it returned something. */
  result?: JsonValue;
  /** The URL, when the action changed it. */
  url?: string;
  /** The document is still loading. */
  loading?: true;
  /** The Page Objects that appeared or went away, and the values that changed, as a tree. */
  changes?: string;
};

/** The source of Page Object Tools both agent channels read. */
export type PageObjectToolSource = {
  /** The Page Object Tools offered now, and `page_objects`. */
  list(): readonly ToolInfo[];
  /** Calls `listener` after the session's tools may have changed. */
  subscribe(listener: () => void): () => void;
  /**
   * Runs the tool `name`. A Page Object Tool answers a
   * `PageObjectToolAnswer`, and its refusal or failure is the error alone,
   * without the Change Record the session left on it. Any other tool
   * answers as the session does.
   */
  run(name: string, input: unknown): Promise<unknown>;
};

const isPageObjectTool = ({ group }: ToolInfo) => group === "pageObject";

/** The Page Object Tools of `session` and their answers, for an agent channel. */
export function pageObjectToolSource(
  session: PageObjectToolSession
): PageObjectToolSource {
  return {
    list: () =>
      session
        .list()
        .filter(
          (tool) => isPageObjectTool(tool) || tool.name === pageObjectsTool.name
        ),
    subscribe: (listener) => session.subscribe(listener),
    async run(name, input) {
      const tool = session.list().find((listed) => listed.name === name);
      if (!tool || !isPageObjectTool(tool)) return session.run(name, input);
      // The tree before, the action and the tree after in the action's own
      // turn: the changes are that action's alone.
      return session.inTurn(async (page) => {
        const before = await page.readPageObjectTree().catch(() => undefined);
        const url = page.url();
        const loads = page.watchLoads?.();
        try {
          const result = await page.run(name, input).catch((error: unknown) => {
            throw withoutChangeRecord(error);
          });
          return await answerOf(
            page,
            result as ActionResult,
            before,
            url,
            loads
          );
        } finally {
          loads?.stop();
        }
      });
    },
  };
}

/**
 * A failed action's error without the Change Record the session left on
 * it: the same error, which the Run log has recorded by now.
 */
function withoutChangeRecord(error: unknown): unknown {
  if (error instanceof Error)
    for (const part of ["page_changed", "changes_before", "changes"] as const)
      delete (error as Partial<ActionFailure>)[part];
  return error;
}

async function answerOf(
  session: PageObjectToolTurn,
  { settled, result, loading }: ActionResult,
  before: PageObjectTreeRead | undefined,
  url: string,
  loads: LoadWatch | undefined
): Promise<PageObjectToolAnswer> {
  const answer: PageObjectToolAnswer = {
    settled,
    ...(result === undefined ? {} : { result }),
  };
  if (loading !== undefined) {
    // A session that outlives the load answers from the new document once
    // it has settled, as from any other page the action led to.
    const loaded = await loads?.loaded();
    // A full load ends this document: its tree is not read again.
    if (!loaded)
      return {
        ...answer,
        ...(loading === url ? {} : { url: loading }),
        loading: true,
      };
    answer.settled = loaded.settled;
  }
  const now = session.url();
  if (now !== url) answer.url = now;
  const after = await session.readPageObjectTree().catch(() => undefined);
  const changes = before && after && renderPageObjectTreeChanges(before, after);
  if (changes) answer.changes = changes;
  return answer;
}
