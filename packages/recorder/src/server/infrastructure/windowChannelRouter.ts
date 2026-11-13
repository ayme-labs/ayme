import { initTRPC } from "@trpc/server";
import * as z from "zod/mini";

import type {
  CommandResult,
  RecorderCommand,
  RecorderCommandType,
  RecorderUpdate,
} from "../../contract";

/** What the window's channel reaches of the recorder: its handle's commands
 * and its updates, as promises and callbacks. */
export type WindowTarget = {
  send(command: RecorderCommand): Promise<CommandResult>;
  /** Calls the listener at once with the full state, then with every
   * change. Returns "unsubscribe". */
  subscribe(listener: (update: RecorderUpdate) => void): () => void;
};

const COMMAND_TYPES = [
  "record",
  "finish",
  "stop",
  "continue",
  "clear",
] as const satisfies readonly RecorderCommandType[];
const CommandSchema = z.object({ type: z.enum(COMMAND_TYPES) });

/** The windows' subscriptions, which the server waits for when it closes. */
export type Subscriptions = {
  /** Resolves when the server closes: a subscription then sends the update
   * it still owes, and ends. */
  readonly closing: Promise<void>;
  /** Each open subscription, until it has ended. */
  readonly open: Set<Promise<void>>;
};

const t = initTRPC
  .context<{
    /** The recorder, once it has started: a window may connect before. */
    readonly target: Promise<WindowTarget>;
    readonly subscriptions: Subscriptions;
  }>()
  .create();

/**
 * The window's channel, as the contract names it: the mutation `send` takes
 * a command and answers it, and the subscription `updates` gives the full
 * state first and then every change. Only the newest update waiting to be
 * sent is sent: each is the full state.
 */
export const windowChannelRouter = t.router({
  send: t.procedure
    .input(CommandSchema)
    .mutation(async ({ ctx, input }) => (await ctx.target).send(input)),
  updates: t.procedure.subscription(async function* ({ ctx, signal }) {
    const { open, closing } = ctx.subscriptions;
    let ended!: () => void;
    const subscription = new Promise<void>((resolve) => (ended = resolve));
    open.add(subscription);
    let newest: RecorderUpdate | undefined;
    let closed = false;
    let wake: (() => void) | undefined;
    void closing.then(() => {
      closed = true;
      wake?.();
    });
    signal?.addEventListener("abort", () => wake?.());
    const target = await ctx.target;
    const unsubscribe = target.subscribe((update) => {
      newest = update;
      wake?.();
    });
    try {
      while (!signal?.aborted) {
        if (newest) {
          const update = newest;
          newest = undefined;
          yield update;
          continue;
        }
        // The last update is sent: there is nothing more to tell.
        if (closed) return;
        await new Promise<void>((resolve) => (wake = resolve));
        wake = undefined;
      }
    } finally {
      unsubscribe();
      open.delete(subscription);
      ended();
    }
  }),
});
