import * as z from "zod/mini";

import type {
  CommandResult,
  RecorderUpdate,
  ToolbarMessage,
} from "../../contract";
import { CommandSchema, type WindowTarget } from "./windowChannelRouter";

/**
 * The in-page toolbar's way to the recorder. Every recorded page gets one
 * function, which the toolbar calls with a `ToolbarMessage`: the browser's
 * adapter exposes `answer` as that function, and knows nothing else of the
 * toolbar. It reaches the recorder only through the handle every caller
 * gets, attached by the composition root, as the window's channel does.
 */
export type ToolbarBridge = {
  /** Answers one message from a page. Anything that is not a toolbar's
   * message is answered "ignored". */
  answer(message: unknown): Promise<CommandResult | RecorderUpdate | null>;
  /** Hands it the started recorder. A toolbar that asks before waits. */
  attach(target: WindowTarget): void;
  /** The recorder has ended: a toolbar that waits is told its last update,
   * and is answered null from then on. */
  close(): void;
};

const MessageSchema = z.union([
  z.object({ kind: z.literal("send"), command: CommandSchema }),
  z.object({ kind: z.literal("update"), after: z.number() }),
]);

/** The toolbar's way to the recorder: state is pulled, one update at a
 * time, so no call into the page is needed to tell it a change. */
export function toolbarBridge(): ToolbarBridge {
  let attach!: (target: WindowTarget) => void;
  const target = new Promise<WindowTarget>((resolve) => (attach = resolve));
  let newest: RecorderUpdate | undefined;
  let closed = false;
  /** Toolbars waiting for an update above their revision. */
  const waiting = new Set<() => void>();
  void target.then(({ subscribe }) =>
    subscribe((update) => {
      newest = update;
      for (const wake of [...waiting]) wake();
    })
  );

  const update = async (after: number): Promise<RecorderUpdate | null> => {
    await target;
    for (;;) {
      if (newest && newest.revision > after) return newest;
      if (closed) return null;
      await new Promise<void>((resolve) => {
        const wake = () => {
          // Stryker disable next-line CallExpression: waking twice settles a promise that is settled; deleting it keeps the set small
          waiting.delete(wake);
          resolve();
        };
        waiting.add(wake);
      });
    }
  };

  return {
    async answer(message) {
      const parsed = MessageSchema.safeParse(message);
      if (!parsed.success) return "ignored";
      const known: ToolbarMessage = parsed.data;
      if (known.kind === "update") return update(known.after);
      return (await target).send(known.command);
    },
    attach,
    close() {
      closed = true;
      for (const wake of [...waiting]) wake();
    },
  };
}
