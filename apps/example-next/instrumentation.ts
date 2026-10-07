// Runs once when the Next.js server starts. In development, the server
// process pairs with the agent's Ayme MCP server as an App Process, beside
// the tab, and offers its Peek `renders` as `peek.node.renders`.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "production") return;
  const [{ createAyme }, { renderCount }] = await Promise.all([
    import("@ayme-dev/ayme"),
    import("./app/renders"),
  ]);
  // The e2e tests run the agent's server on a port of their own.
  const port = process.env.AYME_EXAMPLE_AGENT_PORT;
  const ayme = createAyme({
    agentConnection: port === undefined ? true : { port: Number(port) },
  });
  ayme.startAppProcess();
  ayme.peek(() => ({ renders: renderCount() }), "renders");
}
