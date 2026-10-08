// Runs once when the Next.js server starts. In development, the server
// process pairs with the agent's Ayme MCP server as an App Process, beside
// the tab. Its Peeks live in app code (`app/server-peeks.ts`), not here:
// `next dev` never evaluates this file again, so a Peek added here would
// keep reading the code and module copy it started with.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "production") return;
  const { createAyme } = await import("@ayme-dev/ayme");
  // The e2e tests run the agent's server on a port of their own.
  const port = process.env.AYME_EXAMPLE_AGENT_PORT;
  createAyme({
    agentConnection: port === undefined ? true : { port: Number(port) },
  }).start();
}
