// A Nitro server plugin, run once when the server starts. In development,
// the server process pairs with the agent's Ayme MCP server as an App
// Process, beside the tab, and offers its Peek `renders`, how often it
// rendered a page, as `peek.node.renders`.
export default defineNitroPlugin((nitroApp) => {
  if (!import.meta.dev) return;
  let renders = 0;
  nitroApp.hooks.hook("render:response", () => {
    renders += 1;
  });
  void import("@ayme-dev/ayme").then(({ createAyme }) => {
    // The e2e tests run the agent's server on a port of their own.
    const port = process.env.AYME_EXAMPLE_AGENT_PORT;
    const ayme = createAyme({
      agentConnection: port === undefined ? true : { port: Number(port) },
    });
    ayme.start();
    ayme.peek(() => ({ renders }), "renders");
  });
});
