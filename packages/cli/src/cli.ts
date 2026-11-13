#!/usr/bin/env node
import { codegen } from "./codegen";
import { readCommand } from "./readCommand";

const command = readCommand(process.argv.slice(2));
if (command.kind === "help") {
  process.stdout.write(command.text);
} else if (command.kind === "error") {
  process.stderr.write(command.text);
  process.exitCode = 1;
} else if (command.kind === "attach") {
  process.exitCode = await codegen({ cdpEndpoint: command.cdpEndpoint });
} else {
  process.exitCode = await codegen({ url: command.url });
}
