import { initTRPC } from "@trpc/server";

import {
  HelloSchema,
  PageLeavingSchema,
  PageToolListSchema,
  ProcessToolCallSchema,
  ToolCallOutcomeSchema,
  ToolCallSchema,
  ToolReportAnswerSchema,
  type Hello,
  type PageWelcome,
} from "../../contract";
import {
  PageSession,
  type AgentConnection,
  type ChannelSession,
} from "../application/agentConnection";

/**
 * One WebSocket connection's context: the server's Agent Connection, and
 * the page or App Process on its other end, which is known once it said
 * hello.
 */
export type PageChannelContext = {
  connection: AgentConnection;
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
 * document, follows the App Processes' tools and runs one of them, as its
 * Inspector does.
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
  processTools: t.procedure.subscription(async function* ({ ctx, signal }) {
    // An App Process does not see the other App Processes' tools.
    if (!((await ctx.page.session) instanceof PageSession)) return;
    for await (const tools of ctx.connection.processToolLists(signal))
      yield PageToolListSchema.parse(tools);
  }),
  callProcessTool: t.procedure
    .input(ProcessToolCallSchema)
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.page.session;
      if (!(session instanceof PageSession))
        throw new Error("Only the page runs the App Processes' tools.");
      return ToolCallOutcomeSchema.parse(
        await ctx.connection.callProcess(input.name, input.input)
      );
    }),
});

export type PageChannelRouter = typeof pageChannelRouter;
