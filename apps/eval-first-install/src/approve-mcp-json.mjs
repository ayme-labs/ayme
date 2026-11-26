// A PermissionRequest hook for the worker's Claude Code. Claude Code asks
// the user before any edit of .mcp.json, even under acceptEdits and an allow
// rule, and a headless run declines every question. A first-time user
// registering a server answers yes, so this hook does: it approves a Write or
// Edit of a .mcp.json and leaves every other question unanswered, which
// headless Claude Code declines as before. Each approval is logged to the
// file named by the first argument.
//
//   node approve-mcp-json.mjs <log>
import { appendFileSync } from "node:fs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const event = JSON.parse(input);
const file = event.tool_input?.file_path ?? "";

if (file === ".mcp.json" || file.endsWith("/.mcp.json")) {
  appendFileSync(process.argv[2], `${event.tool_name} ${file}\n`);
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow" },
      },
    })
  );
}
