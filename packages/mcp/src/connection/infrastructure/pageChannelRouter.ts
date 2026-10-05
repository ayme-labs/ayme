import { initTRPC } from "@trpc/server";

import {
  PageHelloSchema,
  PageLeavingSchema,
  PageToolListSchema,
  ToolCallOutcomeSchema,
  ToolCallSchema,
  type PageHello,
  type PageWelcome,
} from "../../contract";
import type { PageSession } from "../application/agentConnection";

/**
 * One WebSocket connection's context: the page on its other end, which is
 * known once it said hello.
 */
export type PageChannelContext = {
  page: {
    hello(hello: PageHello): PageWelcome;
    /** Resolves once the page said hello and the server paired it. */
    session: Promise<PageSession>;
  };
};

const t = initTRPC.context<PageChannelContext>().create();

/**
 * The channel's procedures, which the page client calls: it says hello,
 * reports its tools, receives calls through a subscription, answers each
 * one, and says when it starts loading a new document.
 */
export const pageChannelRouter = t.router({
  hello: t.procedure
    .input(PageHelloSchema)
    .mutation(({ ctx, input }) => ctx.page.hello(input)),
  publishTools: t.procedure
    .input(PageToolListSchema)
    .mutation(async ({ ctx, input }) =>
      (await ctx.page.session).publishTools(input)
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
      (await ctx.page.session).leaving = input;
    }),
});

export type PageChannelRouter = typeof pageChannelRouter;
