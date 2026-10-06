import { initTRPC } from "@trpc/server";

import {
  HelloSchema,
  PageLeavingSchema,
  PageToolListSchema,
  ToolCallOutcomeSchema,
  ToolCallSchema,
  ToolReportAnswerSchema,
  type Hello,
  type PageWelcome,
} from "../../contract";
import {
  PageSession,
  type ChannelSession,
} from "../application/agentConnection";

/**
 * One WebSocket connection's context: the page or App Process on its other
 * end, which is known once it said hello.
 */
export type PageChannelContext = {
  page: {
    hello(hello: Hello): PageWelcome;
    /** Resolves once the other end said hello and the server paired it. */
    session: Promise<ChannelSession>;
  };
};

const t = initTRPC.context<PageChannelContext>().create();

/**
 * The channel's procedures, which the page client and the App Process call:
 * it says hello, reports its tools, receives calls through a subscription,
 * answers each one, and, a page only, says when it starts loading a new
 * document.
 */
export const pageChannelRouter = t.router({
  hello: t.procedure
    .input(HelloSchema)
    .mutation(({ ctx, input }) => ctx.page.hello(input)),
  publishTools: t.procedure
    .input(PageToolListSchema)
    .mutation(async ({ ctx, input }) =>
      ToolReportAnswerSchema.parse((await ctx.page.session).publishTools(input))
    ),
  calls: t.procedure.subscription(async function* ({ ctx, signal }) {
    const session = await ctx.page.session;
    for await (const call of session.calls(signal))
      yield ToolCallSchema.parse(call);
  }),
  answer: t.procedure
    .input(ToolCallOutcomeSchema)
    .mutation(async ({ ctx, input }) => (await ctx.page.session).answer(input)),
  leaving: t.procedure
    .input(PageLeavingSchema)
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.page.session;
      // An App Process has no document to leave.
      if (session instanceof PageSession) session.leaving = input;
    }),
});

export type PageChannelRouter = typeof pageChannelRouter;
