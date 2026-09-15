#!/usr/bin/env node
/*
 * Run one dashboard-confirmation turn, resume the same Codex task with the
 * measured task, and aggregate usage from the resumed JSONL log.
 *
 * Profiles must already configure the corresponding tool surface:
 *   node measure-codex-interactions.mjs \
 *     --task "Open the inbox" \
 *     --profile webmcp=webmcp \
 *     --profile playwright=playwright \
 *     --profile computer-use=computer-use
 *
 * This script is intentionally not run by the benchmark itself. It only
 * starts Codex when explicitly invoked by the user.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const task = args.task;
const outputDir = path.resolve(args.out ?? "codex-token-runs");
const workingDir = path.resolve(args.cd ?? process.cwd());
const profiles = args.profiles;
const url = args.url;
const model = args.model ?? "gpt-5.6-luna";
const reasoning = args.reasoning ?? "medium";
const timeoutMs = args.timeoutMs ?? 90_000;
const modelArgs = [
  "--model",
  model,
  "--config",
  `model_reasoning_effort="${reasoning}"`,
];
const configuredMcpServers = [
  "webmcp-local-relay",
  "playwright",
  "computer-use",
  "fynk",
];

if (
  !task ||
  profiles.length === 0 ||
  (profiles.some(({ method }) => method !== "webmcp") && !url)
) {
  console.error(usage());
  process.exitCode = 2;
} else {
  await main();
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  for (const { method, profile } of profiles) {
    const runDir = path.join(outputDir, method);
    await mkdir(runDir, { recursive: true });

    const setupPrompt = [
      `Use only the ${toolLabel(method)} for browser interaction to complete your task.`,
      ...(method === "webmcp" ? [] : [`Open the ${url} page.`]),
      "When you can see the fynk dashboard, reply exactly:",
      "DASHBOARD_READY",
    ].join("\n\n");

    const setup = await runCodex([
      "exec",
      ...modelArgs,
      ...toolConfigArgs(method),
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
      ...(profile ? ["--profile", profile] : []),
      "--cd",
      workingDir,
      "--skip-git-repo-check",
      setupPrompt,
    ]);
    await writeRun(runDir, "setup", setup);

    if (setup.timedOut) {
      throw new Error(`${method}: setup timed out after ${timeoutMs}ms`);
    }
    if (setup.exitCode !== 0) {
      throw new Error(`${method}: setup exited with code ${setup.exitCode}`);
    }
    if (!setup.stdout.includes("DASHBOARD_READY")) {
      throw new Error(`${method}: setup did not confirm DASHBOARD_READY`);
    }

    const threadId = findThreadId(setup.stdout);
    if (!threadId) {
      throw new Error(`${method}: no thread ID found in Codex JSONL output`);
    }

    const measured = await runCodex([
      "exec",
      "resume",
      ...modelArgs,
      ...toolConfigArgs(method),
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
      "--skip-git-repo-check",
      ...(profile ? ["--profile", profile] : []),
      threadId,
      task,
    ]);
    await writeRun(runDir, "task", measured);

    if (measured.timedOut) {
      throw new Error(
        `${method}: measured task timed out after ${timeoutMs}ms`
      );
    }
    if (measured.exitCode !== 0) {
      throw new Error(
        `${method}: measured task exited with code ${measured.exitCode}`
      );
    }

    const summary = aggregateUsage(measured.stdout);
    await writeFile(
      path.join(runDir, "summary.json"),
      `${JSON.stringify({ method, profile, threadId, ...summary }, null, 2)}\n`
    );
    console.log(JSON.stringify({ method, threadId, ...summary }));
  }
}

function runCodex(codexArgs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn("codex", codexArgs, {
      cwd: workingDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer;
    const killProcessGroup = (signal) => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        child.kill(signal);
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessGroup("SIGTERM");
      killTimer = setTimeout(() => killProcessGroup("SIGKILL"), 5_000);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function writeRun(runDir, phase, result) {
  await writeFile(path.join(runDir, `${phase}.jsonl`), result.stdout);
  await writeFile(path.join(runDir, `${phase}.stderr.log`), result.stderr);
  await writeFile(
    path.join(runDir, `${phase}.meta.json`),
    `${JSON.stringify({ exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, durationMs: result.durationMs }, null, 2)}\n`
  );
}

function findThreadId(stdout) {
  for (const event of parseJsonl(stdout)) {
    if (event.type !== "thread.started") continue;
    if (typeof event.thread_id === "string") return event.thread_id;
    if (typeof event.thread?.id === "string") return event.thread.id;
  }
  return undefined;
}

function aggregateUsage(stdout) {
  const usage = parseJsonl(stdout)
    .filter((event) => event.type === "turn.completed" && event.usage)
    .map((event) => event.usage);

  return usage.reduce(
    (total, current) => ({
      turns: total.turns + 1,
      input_tokens: total.input_tokens + number(current.input_tokens),
      output_tokens: total.output_tokens + number(current.output_tokens),
      total_tokens:
        total.total_tokens +
        number(
          current.total_tokens ??
            number(current.input_tokens) + number(current.output_tokens)
        ),
      cached_input_tokens:
        total.cached_input_tokens +
        number(
          current.cached_input_tokens ??
            current.input_tokens_details?.cached_tokens
        ),
      reasoning_tokens:
        total.reasoning_tokens +
        number(
          current.reasoning_output_tokens ??
            current.output_tokens_details?.reasoning_tokens
        ),
    }),
    {
      turns: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cached_input_tokens: 0,
      reasoning_tokens: 0,
    }
  );
}

function parseJsonl(stdout) {
  return stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseArgs(argv) {
  const result = { profiles: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--task") result.task = argv[++index];
    else if (arg === "--out") result.out = argv[++index];
    else if (arg === "--cd") result.cd = argv[++index];
    else if (arg === "--url") result.url = argv[++index];
    else if (arg === "--model") result.model = argv[++index];
    else if (arg === "--reasoning") result.reasoning = argv[++index];
    else if (arg === "--timeout-ms") result.timeoutMs = Number(argv[++index]);
    else if (arg === "--profile") {
      const [method, profile] = String(argv[++index] ?? "").split("=", 2);
      if (method) result.profiles.push({ method, profile });
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function usage() {
  return [
    "Usage:",
    '  node measure-codex-interactions.mjs --task "..." --profile method[=codex-profile] [--profile method[=codex-profile]] [--url URL] [--model MODEL] [--reasoning EFFORT] [--timeout-ms MS]',
    "",
    "The script does not run until invoked. Each profile must configure exactly one interaction surface.",
    "--url is required for Playwright and computer use, and omitted for WebMCP.",
    "The default timeout is 90000ms per setup/task phase.",
  ].join("\n");
}

function toolLabel(method) {
  return (
    {
      webmcp: "webmcp local relay",
      playwright: "playwright MCP",
      "computer-use": "computer use",
    }[method] ?? method
  );
}

function toolConfigArgs(method) {
  const serverByMethod = {
    webmcp: "webmcp-local-relay",
    playwright: "playwright",
    "computer-use": "computer-use",
  };
  const target = serverByMethod[method];
  if (!target) throw new Error(`Unknown interaction method: ${method}`);

  return configuredMcpServers.flatMap((server) => [
    "--config",
    `mcp_servers.${server}.enabled=${server === target}`,
  ]);
}
