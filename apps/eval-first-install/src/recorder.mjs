// Records every `ayme` command of `@ayme-dev/cli`, however the worker runs it
// (npx, node_modules/.bin, a global copy): its arguments, folder and phase
// when it starts, and its exit code and all it printed when it ends. The
// harness loads this file into every Node process the worker starts, through
// NODE_OPTIONS=--import, names the record file in EVAL_FIRST_INSTALL_RECORD,
// outside the worker's project so the worker's npm install cannot replace it,
// and the phase in EVAL_FIRST_INSTALL_PHASE. In any other process it does
// nothing.
//
// Lines: {"t", "pid", "event": "start", "phase", "args", "cwd"} and
// {"t", "pid", "event": "end", "code", "stdout", "stderr"}. A command killed
// by a signal has no end.
import { Buffer } from "node:buffer";
import { appendFileSync, realpathSync } from "node:fs";
import process from "node:process";

const file = process.env.EVAL_FIRST_INSTALL_RECORD;
const script = process.argv[1];
let isAyme = false;
if (file && script) {
  try {
    isAyme =
      /[\\/]@ayme-dev[\\/]cli[\\/]/.test(realpathSync(script)) &&
      // The Session's background process, which `ayme open` and `ayme attach`
      // start with this word: not a command the worker ran.
      process.argv[2] !== "__session";
  } catch {
    isAyme = false;
  }
}

if (isAyme) {
  const record = (fields) => {
    try {
      appendFileSync(
        file,
        `${JSON.stringify({ t: new Date().toISOString(), pid: process.pid, ...fields })}\n`
      );
    } catch {
      // Recording must never break the command.
    }
  };
  record({
    event: "start",
    phase: process.env.EVAL_FIRST_INSTALL_PHASE,
    args: process.argv.slice(2),
    cwd: process.cwd(),
  });

  const printed = { stdout: "", stderr: "" };
  for (const name of ["stdout", "stderr"]) {
    const stream = process[name];
    const write = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => {
      printed[name] +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return write(chunk, ...rest);
    };
  }

  process.on("exit", (code) => record({ event: "end", code, ...printed }));
}
