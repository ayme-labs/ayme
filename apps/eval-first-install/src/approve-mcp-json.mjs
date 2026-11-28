// A PermissionRequest hook for the worker's Claude Code. Claude Code asks
// the user before an edit of .mcp.json, even under acceptEdits and with Bash
// allowed, and a headless run declines every question. A first-time user
// registering a server, such as Playwright MCP, answers yes, so this hook
// does: it approves a Write or Edit of the project's own .mcp.json, and a Bash
// command whose every .mcp.json is the project's, and leaves every other
// question unanswered, which headless Claude Code declines as before. Each
// approval is logged to the file named by the first argument.
//
//   node approve-mcp-json.mjs <log>
import { appendFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const event = JSON.parse(input);
const cwd = event.cwd ?? process.cwd();

/** Whether `file` is the .mcp.json in `cwd`, the worker's project, even through a symlink. */
function isProjectMcpJson(file) {
  const path = resolve(cwd, file);
  if (basename(path) !== ".mcp.json") return false;
  try {
    return realpathSync(dirname(path)) === realpathSync(cwd);
  } catch {
    return false;
  }
}

/** The paths to a .mcp.json that `command` names, bare or quoted. */
const mcpJsonPaths = (command) =>
  [...command.matchAll(/[^\s'"();|&<>=]*\.mcp\.json(?![\w.-])/g)].map(
    ([path]) => path
  );

let asked;
if (event.tool_name === "Write" || event.tool_name === "Edit") {
  const file = event.tool_input?.file_path ?? "";
  if (file && isProjectMcpJson(file)) asked = file;
} else if (event.tool_name === "Bash") {
  const command = event.tool_input?.command ?? "";
  const paths = mcpJsonPaths(command);
  if (paths.length > 0 && paths.every(isProjectMcpJson)) asked = command;
}

if (asked !== undefined) {
  appendFileSync(process.argv[2], `${event.tool_name} ${asked}\n`);
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    })}\n`
  );
}
