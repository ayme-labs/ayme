/**
 * One headless Claude Code session that writes a page object from a plan.
 *
 *   SPIKE_CLAUDE_TOKEN_FILE=<env file> node pom-agent.mjs <scratch-dir> <log-file>
 *
 * The session works in <scratch-dir> only: file tools (Read, Write, Edit,
 * Glob, Grep), no shell, no web, and a permission check that refuses any
 * path outside the directory. Its only credential is CLAUDE_CODE_OAUTH_TOKEN,
 * read at start from the one line of the env file that holds it; the value
 * is never written or logged. The log gets the tools called, the result's
 * turns, duration, cost, and usage, and the final summary.
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

const [scratch, logFile] = process.argv
  .slice(2)
  .map((arg) => path.resolve(arg));
if (scratch === undefined || logFile === undefined)
  throw new Error("usage: node pom-agent.mjs <scratch-dir> <log-file>");

const FILTER = /^(ANTHROPIC_.*|CLAUDE_.*|CLAUDECODE|.*OPENROUTER.*)$/i;
const prefix = "CLAUDE_CODE_OAUTH_TOKEN=";
const token = readFileSync(process.env.SPIKE_CLAUDE_TOKEN_FILE, "utf8")
  .split("\n")
  .find((line) => line.startsWith(prefix))
  ?.slice(prefix.length)
  .trim()
  .replace(/^["']|["']$/g, "");
if (!token)
  throw new Error("no CLAUDE_CODE_OAUTH_TOKEN in SPIKE_CLAUDE_TOKEN_FILE");

const PROMPT = `You are working in a small copy of a React app that uses Ayme (a library that turns Playwright page object models into tools).

Task: write the Ayme page object for the app's Projects screen at app/src/pom/ProjectsPage.ts (the app's main.tsx already imports it from there).

Inputs:
- PLAN.json: a plan derived deterministically from recorded end-to-end test runs on this screen. Three tests recorded the same flow; the plan collapses them into one method, proposes member locators with names, a child page object candidate for the container some controls were recorded in, method parameters, and a final wait. Its "judgment" list names what the recordings could not decide; decide those from the app source.
- app/src/main.tsx: the app source. app/playwright/pom/CounterPage.ts: an existing page object in this project; follow its conventions.
- docs/page-object-models.md and docs/playwright-in-the-browser.md: how Ayme page objects work (@ayme, @ayme.action, members, Page Object Children, the root member).

Requirements:
- An @ayme class ProjectsPage with a constructor taking a Playwright Page, and a top-level @ayme.action method implementing the plan's method, with the plan's parameters.
- Locators as named readonly members (no inline locators inside methods), with names that say what the control is for.
- A child page object where the plan proposes one, with a root locator you choose from the app source; give it its own marked actions if that reads well, but keep the top-level method.
- Real descriptions on the class and every action.
- Only write files under app/src/pom/. Do not modify any other file.

Finish with a short summary: the names you chose, the child's root, and each judgment call you made and why.`;

const toolsUsed = [];
const insideScratch = (input) => {
  const target = input.file_path ?? input.path ?? scratch;
  const resolved = path.resolve(scratch, target);
  return resolved === scratch || resolved.startsWith(`${scratch}${path.sep}`);
};

const conversation = query({
  prompt: PROMPT,
  options: {
    model: process.env.SPIKE_CLAUDE_MODEL ?? "sonnet",
    cwd: scratch,
    tools: ["Read", "Write", "Edit", "Glob", "Grep"],
    settingSources: [],
    skills: [],
    strictMcpConfig: true,
    persistSession: false,
    maxTurns: 40,
    permissionMode: "default",
    canUseTool: async (toolName, input) => {
      toolsUsed.push(toolName);
      return insideScratch(input)
        ? { behavior: "allow", updatedInput: input }
        : {
            behavior: "deny",
            message: "only files inside the working directory are available",
          };
    },
    stderr: (data) => appendFileSync(`${logFile}.stderr`, data),
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !FILTER.test(key))
      ),
      CLAUDE_AGENT_SDK_CLIENT_APP: "ayme-spike-pom-agent/0",
      CLAUDE_CODE_OAUTH_TOKEN: token,
    },
  },
});

const startedMs = Date.now();
let init;
let result;
const toolCalls = [];
for await (const message of conversation) {
  if (message.type === "system" && message.subtype === "init")
    init = {
      apiKeySource: message.apiKeySource,
      model: message.model,
      tools: message.tools,
    };
  if (message.type === "assistant") {
    for (const block of message.message.content ?? []) {
      if (block.type === "tool_use")
        toolCalls.push(
          `${block.name} ${block.input?.file_path ?? block.input?.path ?? block.input?.pattern ?? ""}`.trim()
        );
    }
  }
  if (message.type === "result") result = message;
}
writeFileSync(
  logFile,
  `${JSON.stringify(
    {
      wallMs: Date.now() - startedMs,
      init,
      toolCalls,
      permissionChecks: toolsUsed,
      result: result && {
        subtype: result.subtype,
        numTurns: result.num_turns,
        durationMs: result.duration_ms,
        totalCostUsd: result.total_cost_usd,
        usage: result.usage,
        modelUsage: result.modelUsage,
        summary: result.subtype === "success" ? result.result : result.errors,
      },
    },
    null,
    2
  )}\n`
);
console.log(
  `done: ${result?.subtype} turns=${result?.num_turns} cost=${result?.total_cost_usd}`
);
