// How the two agent channels, WebMCP publication and `ayme mcp`, run a tool:
// both build their source with `pageObjectToolSource`, each over its own
// Caller, so a Page Object Tool's answer cannot differ between them.
// `ayme.tools.run` keeps answering the full record, which application code,
// the Inspector and the Goal Loop read.
import {
  renderPageObjectTreeChanges,
  type PageObjectTreeRead,
} from "../page-objects/domain";
import type { ActionFailure, ActionResult } from "../page-state/domain";
import type { JsonValue, ToolInfo } from "../shared";

/** What the source reads of the session, its calls made by one Caller. */
export type PageObjectToolSession = {
  list(): readonly ToolInfo[];
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
  url(): string;
};

export type PageObjectToolAnswer = {
  /**
   * Whether the page settled after the action. `false` while a new document
   * the action started loads, too.
   */
  settled: boolean;
  /** What the Page Object Action returned, when it returned something. */
  result?: JsonValue;
  /** The URL, when the action changed it. */
  url?: string;
  /** The Page Objects that appeared or went away, and the values that changed, as a tree. */
  changes?: string;
};

/** How both agent channels run a tool. */
export type PageObjectToolSource = {
  /**
   * Runs the tool `name`. A Page Object Tool answers a
   * `PageObjectToolAnswer`, and its refusal or failure is the error,
   * without the Change Record the session left on it but with `changes`,
   * how the Page Object Tree changed, when it changed. Any other tool
   * answers as the session does.
   */
  run(name: string, input: unknown): Promise<unknown>;
};

const isPageObjectTool = ({ group }: ToolInfo) => group === "pageObject";

/** The tools of `session` as an agent channel runs them. */
export function pageObjectToolSource(
  session: PageObjectToolSession
): PageObjectToolSource {
  return {
    async run(name, input) {
      const tool = session.list().find((listed) => listed.name === name);
      if (!tool || !isPageObjectTool(tool)) return session.run(name, input);
      // The tree before, the action and the tree after in the action's own
      // turn: the changes are that action's alone.
      return session.inTurn(async (page) => {
        const before = await page.readPageObjectTree().catch(() => undefined);
        const url = page.url();
        const result = await page
          .run(name, input)
          .catch(async (error: unknown) => {
            throw withTreeChanges(
              withoutChangeRecord(error),
              before,
              await page.readPageObjectTree().catch(() => undefined)
            );
          });
        return answerOf(page, result as ActionResult, before, url);
      });
    },
  };
}

/**
 * A failed action's error with how the Page Object Tree changed while it
 * ran, when it changed, as a successful call's answer carries it: an agent
 * sees what a half-run action did.
 */
function withTreeChanges(
  error: unknown,
  before: PageObjectTreeRead | undefined,
  after: PageObjectTreeRead | undefined
): unknown {
  const changes = before && after && renderPageObjectTreeChanges(before, after);
  if (changes && error instanceof Error)
    (error as Partial<ActionFailure>).changes = changes;
  return error;
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
  url: string
): Promise<PageObjectToolAnswer> {
  const answer: PageObjectToolAnswer = {
    settled,
    ...(result === undefined ? {} : { result }),
  };
  // A full load ends this document: its tree is not read again, and the
  // page has not settled until the new one has loaded.
  if (loading !== undefined)
    return {
      ...answer,
      settled: false,
      ...(loading === url ? {} : { url: loading }),
    };
  const now = session.url();
  if (now !== url) answer.url = now;
  const after = await session.readPageObjectTree().catch(() => undefined);
  const changes = before && after && renderPageObjectTreeChanges(before, after);
  if (changes) answer.changes = changes;
  return answer;
}
