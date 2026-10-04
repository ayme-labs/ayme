import { initTRPC } from "@trpc/server";

import {
  PageToolListSchema,
  ToolCallOutcomeSchema,
  ToolCallSchema,
} from "../../contract";
import type { PageSession } from "../application/agentConnection";

/** One WebSocket connection's context: the page on its other end. */
export type PageChannelContext = { page: PageSession };

const t = initTRPC.context<PageChannelContext>().create();

/**
 * The channel's procedures, which the page client calls: it reports its
 * tools, receives calls through a subscription, and answers each one.
 */
export const pageChannelRouter = t.router({
  publishTools: t.procedure
    .input(PageToolListSchema)
    .mutation(({ ctx, input }) => ctx.page.publishTools(input)),
  calls: t.procedure.subscription(async function* ({ ctx, signal }) {
    for await (const call of ctx.page.calls(signal))
      yield ToolCallSchema.parse(call);
  }),
  answer: t.procedure
    .input(ToolCallOutcomeSchema)
    .mutation(({ ctx, input }) => ctx.page.answer(input)),
});

export type PageChannelRouter = typeof pageChannelRouter;
