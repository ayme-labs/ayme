// Records every `ayme` command the agent runs: its arguments when it starts,
// and its exit code and all it printed when it ends. The agent's `ayme`
// executable (aymeShimScript in ayme.ts) loads this file with --import and
// names the record file in EVAL_FORMBRICKS_AYME_RECORD, in the run folder,
// which the agent cannot read. The harness's own `ayme` commands run without
// it.
//
// Lines: {"t", "pid", "event": "start", "args"} and
// {"t", "pid", "event": "end", "code", "stdout", "stderr"}. A command killed
// by a signal has no end.
import { Buffer } from "node:buffer";
import { appendFileSync } from "node:fs";
import process from "node:process";

const file = process.env.EVAL_FORMBRICKS_AYME_RECORD;
// The Session's background process, which `ayme open` and `ayme attach` start
// with this word: not a command the agent ran.
const isAgentCommand = Boolean(file) && process.argv[2] !== "__session";

if (isAgentCommand) {
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
  record({ event: "start", args: process.argv.slice(2) });

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
