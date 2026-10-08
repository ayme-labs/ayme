import { createAyme } from "@ayme-dev/ayme";
import { renderCount } from "./renders";

// The server's Peek `renders`, read as `peek.node.renders` through the App
// Process `instrumentation.ts` starts. The root layout imports this module,
// so it reads the same `renders` module as the page, and after an edit the
// next request evaluates it again and replaces the Peek with fresh code.
// The session is never started: Peeks of every session in the process
// reach its App Process.
createAyme({
  agentConnection: process.env.NODE_ENV !== "production",
}).peek(() => ({ renders: renderCount() }), "renders");
