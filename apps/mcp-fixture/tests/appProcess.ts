// A stand-in App Process for the e2e tests: a Node process of the app that
// starts Ayme with the Agent Connection on and adds one Peek, as an app's
// server entry does. The environment says which Peek, what it reads, and
// where the server is: AYME_PROCESS_PORT is the one port it looks for a
// server on; AYME_PROCESS_LINK a connect link that names one.
import { createAyme } from "@ayme-dev/ayme";

const name = process.env.AYME_PROCESS_PEEK ?? "jobs";
const value = process.env.AYME_PROCESS_VALUE ?? "";
const port = process.env.AYME_PROCESS_PORT;
const link = process.env.AYME_PROCESS_LINK;

const ayme = createAyme({
  agentConnection: {
    ...(port === undefined ? {} : { port: Number(port) }),
    ...(link === undefined ? {} : { link }),
  },
});
ayme.start();
ayme.peek(() => ({ value }), name);

// Stays up like a dev server until the test ends it.
setInterval(() => {}, 60_000);
