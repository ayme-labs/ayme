// Records every stdio line of `ayme mcp`, however the worker starts it (npx,
// node_modules/.bin, a global copy). The harness loads this file into every
// Node process the worker starts, through NODE_OPTIONS=--import, and names
// the record file in EVAL_FIRST_INSTALL_RECORD, outside the worker's project,
// so the worker's npm install cannot replace it. In any other process it does
// nothing.
//
// Each line: {"t": ISO time, "pid", "dir": "start" | "in" | "out" | "err" | "exit", "line"}.
import { appendFileSync, realpathSync } from "node:fs";

const file = process.env.EVAL_FIRST_INSTALL_RECORD;
const script = process.argv[1];
let isAymeMcp = false;
if (file && script) {
  try {
    const real = realpathSync(script);
    isAymeMcp =
      /[\\/]@ayme-dev[\\/]mcp[\\/]/.test(real) && process.argv.includes("mcp");
  } catch {
    isAymeMcp = false;
  }
}

if (isAymeMcp) {
  const record = (dir, line) => {
    try {
      appendFileSync(
        file,
        `${JSON.stringify({ t: new Date().toISOString(), pid: process.pid, dir, line })}\n`
      );
    } catch {
      // Recording must never break the server.
    }
  };
  const lines = (dir) => {
    let rest = "";
    return (chunk) => {
      rest +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      for (const part of parts) record(dir, part);
    };
  };
  record(
    "start",
    [process.argv[0], ...process.argv.slice(1)].join(" ") +
      ` (cwd ${process.cwd()})`
  );

  for (const [name, dir] of [
    ["stdout", "out"],
    ["stderr", "err"],
  ]) {
    const stream = process[name];
    const write = stream.write.bind(stream);
    const onChunk = lines(dir);
    stream.write = (chunk, ...rest) => {
      onChunk(chunk);
      return write(chunk, ...rest);
    };
  }

  // Wrap emit rather than adding a listener, so the server's own reads see
  // every chunk and the stream's flow is unchanged.
  const stdin = process.stdin;
  const emit = stdin.emit.bind(stdin);
  const onInput = lines("in");
  stdin.emit = (event, ...args) => {
    if (event === "data") onInput(args[0]);
    return emit(event, ...args);
  };

  process.on("exit", (code) => record("exit", String(code)));
}
