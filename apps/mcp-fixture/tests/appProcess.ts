// A stand-in App Process for the e2e tests: a Node process of the app that
// offers one tool through `@ayme-dev/mcp/process`, as the Ayme runtime will
// for its Peek Tools. The environment says which tool, what it returns, and
// where the server is: AYME_PROCESS_PORT is the one port it looks for a
// server on; AYME_PROCESS_LINK a connect link that names one.
import { startAgentConnection } from "@ayme-dev/mcp/process";

const name = process.env.AYME_PROCESS_TOOL ?? "peek.node.jobs";
const value = process.env.AYME_PROCESS_VALUE ?? "";
const port = process.env.AYME_PROCESS_PORT;
const link = process.env.AYME_PROCESS_LINK;

startAgentConnection(
  {
    tools: {
      list: () => [
        {
          name,
          description: `Reads ${value}.`,
          inputSchema: { type: "object", properties: {} },
        },
      ],
      subscribe: () => () => {},
      run: async () => ({ value }),
    },
  },
  {
    ...(port === undefined ? {} : { port: Number(port) }),
    ...(link === undefined ? {} : { link }),
  }
);

// Stays up like a dev server until the test ends it.
setInterval(() => {}, 60_000);
