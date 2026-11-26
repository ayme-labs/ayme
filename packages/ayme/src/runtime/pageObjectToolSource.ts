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
import { SETTLED_PAGE_DEADLINE_MS } from "@ayme-dev/core/structural-observation";
import { askPresence, returnedObjectOf } from "../page-objects/application";
import { spikeRunGate } from "../runs/application";

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
   * Spike: where the session outlives a full load, as a Node host's does,
   * lets the page settle now, through a load in progress, by the Settled
   * Page deadline: whether it went quiet, or undefined when no document
   * settled by then. The browser runtime's session ends with its document
   * and offers none.
   */
  settle?(): Promise<{ settled: boolean } | undefined>;
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
        const before = await spikeRunGate.timed("read-before", () =>
          page.readPageObjectTree().catch(() => undefined)
        );
        const url = page.url();
        const result = (await spikeRunGate
          .timed("action", () => page.run(name, input))
          .catch((error: unknown) => {
            throw withoutChangeRecord(error);
          })) as ActionResult;
        // Spike: a session that outlives a load answers from the page the
        // action led to once the Page Object it returned is present there.
        // Settled again only when the page changed since it last settled:
        // the action started a load, or the Page Object came after.
        const returned = page.settle && returnedObjectOf(result);
        const presence =
          returned &&
          (await spikeRunGate.timed("presence", () => presenceBy(returned)));
        const settledThere =
          presence === "came" ||
          (presence === "present" && result.loading !== undefined)
            ? await spikeRunGate.timed("settle-there", () => page.settle!())
            : undefined;
        return answerOf(page, result, before, url, settledThere);
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

/**
 * Spike: whether the Page Object an action returned, `returned`, is
 * present by the Settled Page deadline: at the first ask, or after it came.
 * The deadline runs once, from here: it covers the action returning, which
 * an action that started a load may still be about to do, and the asks of
 * the presence predicate after it. Only a declared or inherited presence
 * predicate is waited for: a Page Object without one, or a value that is
 * none, is not.
 */
async function presenceBy(
  returned: Promise<object | undefined>
): Promise<"present" | "came" | undefined> {
  const deadline = Date.now() + SETTLED_PAGE_DEADLINE_MS;
  const pageObject = await within(returned, SETTLED_PAGE_DEADLINE_MS);
  if (!pageObject) return undefined;
  for (let first = true; ; first = false) {
    const { present } = await askPresence(pageObject);
    if (present === undefined) return undefined;
    if (present) return first ? "present" : "came";
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, PRESENCE_POLL_MS));
  }
}

/** Spike: how often the returned Page Object's presence is asked again. */
const PRESENCE_POLL_MS = 50;

/** What `promise` resolves to within `ms`, else undefined. */
async function within<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function answerOf(
  session: PageObjectToolTurn,
  { settled, result, loading }: ActionResult,
  before: PageObjectTreeRead | undefined,
  url: string,
  settledThere: { settled: boolean } | undefined
): Promise<PageObjectToolAnswer> {
  const answer: PageObjectToolAnswer = {
    settled,
    ...(result === undefined ? {} : { result }),
  };
  // A full load ends this document: its tree is not read again, unless the
  // page the action led to has settled since.
  if (loading !== undefined && !settledThere)
    return {
      ...answer,
      ...(loading === url ? {} : { url: loading }),
      loading: true,
    };
  if (settledThere) answer.settled = settledThere.settled;
  const now = session.url();
  if (now !== url) answer.url = now;
  const after = await spikeRunGate.timed("read-after", () =>
    session.readPageObjectTree().catch(() => undefined)
  );
  const changes = before && after && renderPageObjectTreeChanges(before, after);
  if (changes) answer.changes = changes;
  return answer;
}
