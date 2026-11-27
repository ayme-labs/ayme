/**
 * The worker's two prompts. Neither names a channel, a skill or a document:
 * the worker is told which browser automation to use and finds the rest.
 */
export const TOOLS = [
  "playwright-cli",
  "playwright-mcp",
  "agent-browser",
] as const;
export type Tool = (typeof TOOLS)[number];

export const TOOL_NAMES: Record<Tool, string> = {
  "playwright-mcp":
    "Playwright MCP (npm package @playwright/mcp, version 0.0.83)",
  "playwright-cli":
    "Playwright CLI (npm package @playwright/cli, version 0.1.22, command playwright-cli)",
  "agent-browser": "agent-browser (npm package agent-browser, version 0.41.2)",
};

const environmentFacts = `Facts about this environment:
- Any link to https://github.com/ayme-labs/ayme/blob/main/docs/guide/... is the file under ./ayme-docs/ in this folder. You have no web access.
- Install into this project (npm install --save-dev), never globally.
- Run every browser headless.
- An MCP server goes in ./.mcp.json in this folder (project scope) and is not available to you until you are restarted.
- Stay inside this folder. Do not read or change anything outside it. Do not change the Page Objects in ayme/, and do not start, stop or change the app's server.`;

export function setupPrompt(tool: Tool, page: string): string {
  return `I just set this project up and this is your first time in it.

## Brief

The app I work on runs at ${page}. It is a small list app, its server is already running, and its source is not in this folder. The app itself does not include ayme. This project has @ayme-dev/ayme installed, with Page Objects for the app in ayme/.

I want you to do browser tasks on that page for me with ${TOOL_NAMES[tool]}, using the project's ayme Page Objects wherever they fit. Get everything ready for that, and install what it needs; you need not ask me first. Install ${tool} at the version named. I will restart you when you are done, and then give you a task.

${environmentFacts}

Out of scope: any task on the page itself, for now.

When you are ready, tell me what you set up and how you plan to work, each exact command you ran, and anything in the project's documentation that was wrong, missing, contradictory or left you guessing, quoting it.
`;
}

export function taskPrompt(tool: Tool, page: string, n: string): string {
  return `You have been restarted. MCP servers in ./.mcp.json are now started, if there are any.

## Brief

On the page at ${page}:

1. Add an item called: Oat milk ${n}
2. Add an item called: Rye bread ${n}
3. Rename the item "Oat milk ${n}" to: Soy milk ${n}
4. Archive the item "Rye bread ${n}".
5. Confirm that the active items include "Soy milk ${n}" and include neither "Oat milk ${n}" nor "Rye bread ${n}".

Use ${tool} and the project's ayme Page Objects, as you set up. The same environment facts and limits as before apply. If something is not working, diagnose it and fix your setup.

When the task is done, or you are sure it cannot be done, close the browser and anything else you started. Then write ./REPORT.md with these sections and answer with its contents:
- Outcome: done or not done, with the evidence from the page.
- How each step was done: for each numbered step, the exact tool or command you called. Say plainly which steps went through an ayme Page Object Tool and which through plain browser driving, and why.
- How you decided: which documents or help output you read, in order, and which of them decided how you call the Page Objects with ${tool}. If you chose between alternatives, name them and say why you chose as you did.
- Setup as it finally worked: the exact install commands, registrations, config files and start commands.
- Documentation problems: every place a document was wrong, missing, contradictory or left you guessing. For each, quote the sentence with its file name, give the exact command or call, the exact error or output, and what turned out to work.
- Product problems: anything that looks like a defect in ayme or in ${tool}, with the exact call and output.
`;
}
