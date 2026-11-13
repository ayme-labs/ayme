#!/usr/bin/env node
import { runTrace } from "@ayme-dev/recorder";

import { codegen } from "./codegen";
import { readCommand } from "./readCommand";

const command = readCommand(process.argv.slice(2));
if (command.kind === "help") {
  process.stdout.write(command.text);
} else if (command.kind === "error") {
  process.stderr.write(command.text);
  process.exitCode = 1;
} else if (command.kind === "trace") {
  process.exitCode = await runTrace({
    projectDir: process.cwd(),
    args: command.args,
  });
} else {
  process.exitCode = await codegen(command.url);
}
