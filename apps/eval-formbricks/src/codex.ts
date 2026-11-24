/**
 * Runs Codex as the agent, through `codex app-server` over stdio: one
 * process and one thread for the setup message and the task, as with Claude
 * Code, so the arm's MCP servers start once, before the measured turn.
 * `codex exec resume` would start them again inside it.
 *
 * Codex has no per-tool permission rules like Claude Code's, so an arm's
 * `tools` and `allowedTools` do not carry over. The configuration below
 * gives the agent the arm's MCP servers and switches off what Codex adds on
 * its own. Only arms that need neither a command line nor a skill run on it
 * for now; `codexArmProblem` names the others.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import type { Arm, McpServer } from "./arms.ts";
import {
  agentEffort,
  closeStream,
  setupTimeoutMs,
  signalProcessGroup,
  type ClaudeRun,
  type Turn,
} from "./claude.ts";
import { turnCompleted } from "./codexTranscript.ts";
import { envFileName } from "./environment.ts";
import type { Precondition } from "./preconditions.ts";

export const codexDefaultModel = "gpt-6-luna";
/** A Codex access token, which runs on the ChatGPT workspace's plan, not on API billing. */
export const codexTokenVariable = "CODEX_ACCESS_TOKEN";

/** How long the app server may take to exit once its input is closed before it is stopped. */
const exitGraceMs = 5_000;

/**
 * What Codex gives an agent beyond the arm's interface, each switched off:
 * the apps connected to the signed-in account, which arrive even in a fresh
 * configuration folder, plugins, the shell, subagents, and the rest.
 */
const featuresOff = [
  "apps",
  "plugins",
  "shell_tool",
  "unified_exec",
  "multi_agent_v2",
  "image_generation",
  "goals",
  "tool_suggest",
  "sleep_tool",
  "skill_search",
  "computer_use",
  "browser_use",
  "memories",
];

/** A TOML basic string; JSON's escapes are TOML's. */
const toml = (value: string) => JSON.stringify(value);

/**
 * The run's `config.toml`: the model and effort, no approval question ever
 * asked, no project instructions read from the agent's working root, no web
 * search, none of the skills Codex ships with, and the arm's MCP servers with
 * every tool of theirs approved. An MCP server keeps the user's real home
 * folder, which the agent itself does not get (see `codexEnvironment`).
 */
export function codexConfig(options: {
  model: string;
  mcpServers: Record<string, McpServer>;
  /** The home folder the MCP servers run with; the user's own by default. */
  home?: string;
}) {
  const home = options.home ?? os.homedir();
  return [
    `model = ${toml(options.model)}`,
    `model_reasoning_effort = ${toml(agentEffort)}`,
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    "project_doc_max_bytes = 0",
    'web_search = "disabled"',
    "",
    "[agents]",
    "enabled = false",
    "",
    "[skills.bundled]",
    "enabled = false",
    "",
    "[features]",
    ...featuresOff.map((feature) => `${feature} = false`),
    ...Object.entries(options.mcpServers).flatMap(([name, server]) => [
      "",
      `[mcp_servers.${toml(name)}]`,
      `command = ${toml(server.command)}`,
      `args = [${server.args.map(toml).join(", ")}]`,
      `env = { HOME = ${toml(home)} }`,
      // Without it a call is refused: nobody is there to approve it.
      'default_tools_approval_mode = "approve"',
    ]),
    "",
  ].join("\n");
}

/** Why Codex cannot run the arm yet, or `null` when it can. */
export function codexArmProblem(
  arm: Pick<Arm, "id" | "skill" | "withAyme" | "tools">
): string | null {
  if (arm.skill === undefined && !arm.withAyme && !arm.tools.includes("Bash"))
    return null;
  return `The Codex agent does not run the ${arm.id} arm yet: it runs only arms that need no skill and no command line.`;
}

/**
 * The environment the agent runs in: the parent's, minus every variable of
 * an agent or of ayme the launcher may carry, plus the run's own fresh
 * configuration folder, where the sign-in lives. That folder is the agent's
 * home folder too: Codex reads the user's own skills from `~/.agents/skills`
 * whatever its configuration folder is, and the agent must not get them.
 */
export function codexEnvironment(
  options: { configDir: string },
  parent: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) {
    if (!/^(CLAUDE|ANTHROPIC|AYME_|OPENAI|CODEX)/.test(key))
      environment[key] = value;
  }
  environment.CODEX_HOME = options.configDir;
  environment.HOME = options.configDir;
  return environment;
}

/**
 * Whether `codex login status` reports a sign-in with an API key, which
 * bills the API and not the ChatGPT plan.
 */
export function signedInWithApiKey(loginStatus: string) {
  return /api key/i.test(loginStatus);
}

/** How long one of Codex's own commands may take before the sign-in check gives up on it. */
const commandTimeoutMs = 30_000;

const signInFiles = new Set<string>();
/**
 * The sign-in in a run's configuration folder never outlives the harness:
 * it is removed when the process exits, also on an error nothing caught, and
 * on an interrupt. When nothing else handles the interrupt, an agent's
 * driver does while it runs, the harness then ends by the same signal.
 */
export function removeSignInOnExit(file: string) {
  const first = signInFiles.size === 0;
  signInFiles.add(file);
  if (!first) return;
  const removeAll = () => {
    for (const signInFile of signInFiles) rmSync(signInFile, { force: true });
  };
  process.on("exit", removeAll);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const onSignal = () => {
      removeAll();
      if (process.listenerCount(signal) > 1) return;
      process.off(signal, onSignal);
      process.kill(process.pid, signal);
    };
    process.on(signal, onSignal);
  }
}

export function codexVersion(): string | null {
  const result = spawnSync("codex", ["--version"], {
    encoding: "utf8",
    timeout: commandTimeoutMs,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim().replace(/^codex-cli\s+/, "") || null;
}

/**
 * Codex must be installed and signed in inside the run's configuration
 * folder. With an access token, Codex signs in with it there, so the token
 * stays out of the agent's environment. Without one, on a
 * developer's machine, the sign-in file of the user's own Codex is copied
 * in. A sign-in with an API key is refused, since it bills the API. The
 * token is never repeated.
 */
export function codexSignInPrecondition(options: {
  environment: NodeJS.ProcessEnv;
  configDir: string;
  accessToken: string | undefined;
  /** The directory holding the env file, for the message. */
  envDirectory: string;
  /** The user's own Codex folder; `~/.codex` by default. */
  userCodexHome?: string;
}): Precondition {
  return {
    name: "Codex sign-in",
    check: () => {
      if (codexVersion() === null)
        return "Codex is not installed: `codex --version` failed.";
      const userAuth = path.join(
        options.userCodexHome ?? path.join(os.homedir(), ".codex"),
        "auth.json"
      );
      removeSignInOnExit(path.join(options.configDir, "auth.json"));
      if (options.accessToken !== undefined) {
        const login = spawnSync("codex", ["login", "--with-access-token"], {
          env: options.environment,
          input: options.accessToken,
          encoding: "utf8",
          timeout: commandTimeoutMs,
        });
        if (login.status !== 0)
          return `Codex does not accept the ${codexTokenVariable}. Create a new access token in the ChatGPT admin console.`;
      } else if (existsSync(userAuth)) {
        copyFileSync(userAuth, path.join(options.configDir, "auth.json"));
      } else {
        return `No ${codexTokenVariable} and no Codex sign-in. Put \`${codexTokenVariable}=<token>\` in ${path.join(options.envDirectory, envFileName)} (ignored by git), export the variable, or sign in with \`codex login\`.`;
      }
      const status = spawnSync("codex", ["login", "status"], {
        env: options.environment,
        encoding: "utf8",
        timeout: commandTimeoutMs,
      });
      const problem =
        status.status !== 0
          ? "Codex reports that it is not signed in."
          : signedInWithApiKey(`${status.stdout}${status.stderr}`)
            ? "Codex is signed in with an API key, which bills the API. Sign in with a ChatGPT plan: `codex logout`, then `codex login`."
            : null;
      // A sign-in that is refused does not stay in the run folder.
      if (problem !== null)
        rmSync(path.join(options.configDir, "auth.json"), { force: true });
      return problem;
    },
  };
}

export type CodexInvocation = {
  /** The agent's working root. */
  cwd: string;
  /** The agent's environment, from `codexEnvironment`; its `CODEX_HOME` holds the run's `config.toml`. */
  environment: NodeJS.ProcessEnv;
  /** The first message: get ready, without touching the page. */
  setupPrompt: string;
  /** The setup turn's timeout; `setupTimeoutMs` by default. */
  setupTimeoutMs?: number;
  /** The second message: the task. */
  prompt: string;
  /** The task turn's timeout. */
  timeoutMs: number;
  transcriptPath: string;
  stderrPath: string;
};

type Json = Record<string, unknown>;

/**
 * Spawns the app server, starts one thread, sends the setup message and
 * then the task as its turns, writes the server's messages to the
 * transcript, and kills the whole process group when a turn runs out of its
 * timeout. The streamed pieces of the agent's messages are left out of the
 * transcript; each finished message is in it whole.
 */
export async function runCodex(
  invocation: CodexInvocation
): Promise<ClaudeRun> {
  const transcript = createWriteStream(invocation.transcriptPath);
  const stderr = createWriteStream(invocation.stderrPath);
  const startedAt = new Date();
  const child = spawn("codex", ["app-server", "--strict-config"], {
    cwd: invocation.cwd,
    env: invocation.environment,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.pipe(stderr);
  // A message sent to an agent that has already exited must not take the harness down.
  child.stdin.on("error", (error) =>
    stderr.write(`harness: writing to the agent failed: ${error.message}\n`)
  );
  const send = (message: Json) =>
    child.stdin.write(`${JSON.stringify(message)}\n`);

  const lines: string[] = [];
  const answers = new Map<number, (answer: Json) => void>();
  let onTurnCompleted: ((event: { isError: boolean }) => void) | null = null;
  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    let message: Json;
    try {
      message = JSON.parse(line) as Json;
    } catch {
      message = {};
    }
    if (typeof message.method === "string" && message.method.endsWith("/delta"))
      return;
    lines.push(line);
    transcript.write(`${line}\n`);
    if (typeof message.id === "number" && message.method === undefined) {
      answers.get(message.id)?.(message);
      answers.delete(message.id);
    } else if (message.id !== undefined) {
      // The server asks for an approval or an input: nobody is there, so it is refused, not left waiting.
      send({
        id: message.id,
        error: { code: -32601, message: "The eval answers no request." },
      });
    }
    const completed = turnCompleted(line);
    if (completed !== null) onTurnCompleted?.(completed);
  });
  // Registered before the child can close: readline closes with stdout, ahead of the child's own close.
  const readerClosed = new Promise<void>((resolve) =>
    reader.once("close", resolve)
  );
  const closed = new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, closeSignal) =>
      resolve({ exitCode: code, signal: closeSignal })
    );
  });
  const ended = closed.then(
    () => undefined,
    () => undefined
  );

  let nextId = 1;
  /** Sends a request and waits for its answer; `null` when the agent ended first. */
  const request = (method: string, params: Json) =>
    new Promise<Json | null>((resolve) => {
      const id = nextId++;
      answers.set(id, resolve);
      send({ id, method, params });
      void ended.then(() => resolve(null));
    });

  let forceKill: NodeJS.Timeout | undefined;
  const stopChild = () => {
    if (!child.pid) return;
    signalProcessGroup(child.pid, "SIGTERM");
    forceKill ??= setTimeout(() => {
      if (child.pid) signalProcessGroup(child.pid, "SIGKILL");
    }, 10_000);
  };
  // The child runs in its own process group so a timeout can take the MCP server and browser with it;
  // an interrupted harness must do the same instead of leaving them behind.
  let interruptedBy: NodeJS.Signals | null = null;
  const onInterrupt = (received: NodeJS.Signals) => {
    interruptedBy = received;
    stopChild();
    process.once("exit", () => process.kill(process.pid, received));
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);

  let threadId: string | null = null;
  let turnRefused = false;
  /** Sends one message as a turn and waits for its end, the turn's timeout or the agent's end. */
  const turn = async (text: string, timeoutMs: number) => {
    const sentAt = Date.now();
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const result = await new Promise<{ isError: boolean } | null>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        stopChild();
        resolve(null);
      }, timeoutMs);
      onTurnCompleted = resolve;
      void ended.then(() => resolve(null));
      void request("turn/start", {
        threadId,
        input: [{ type: "text", text }],
      }).then((answer) => {
        // A turn the server refused to start never completes.
        if (answer !== null && answer.error !== undefined) {
          turnRefused = true;
          resolve({ isError: true });
        }
      });
    });
    clearTimeout(timer);
    onTurnCompleted = null;
    const timing: Turn = {
      sentAt: new Date(sentAt).toISOString(),
      wallTimeMs: result === null ? null : Date.now() - sentAt,
      timedOut,
    };
    return { turn: timing, result };
  };

  let linger: NodeJS.Timeout | undefined;
  try {
    const setupTimeout = invocation.setupTimeoutMs ?? setupTimeoutMs;
    // Starting up is the setup turn's: its clock starts before the thread exists.
    const setupSentAt = Date.now();
    let startTimedOut = false;
    // A server that never answers ends with the setup turn's timeout too.
    const startTimer = setTimeout(() => {
      startTimedOut = true;
      stopChild();
    }, setupTimeout);
    await request("initialize", {
      clientInfo: { name: "ayme-eval", title: "ayme eval", version: "0.0.0" },
    });
    send({ method: "initialized" });
    const thread = await request("thread/start", { cwd: invocation.cwd });
    const started = thread?.result as { thread?: { id?: unknown } } | undefined;
    threadId =
      typeof started?.thread?.id === "string" ? started.thread.id : null;
    clearTimeout(startTimer);

    const { turn: setupTurn, result: setupResult } =
      threadId === null
        ? {
            turn: { sentAt: "", wallTimeMs: null, timedOut: false },
            result: null,
          }
        : await turn(
            invocation.setupPrompt,
            Math.max(0, setupTimeout - (Date.now() - setupSentAt))
          );
    const setup: Turn = {
      sentAt: new Date(setupSentAt).toISOString(),
      wallTimeMs:
        setupTurn.wallTimeMs === null ? null : Date.now() - setupSentAt,
      timedOut: setupTurn.timedOut || startTimedOut,
    };
    const setupFailure = setup.timedOut
      ? `the setup turn ran out of its ${setupTimeout / 1000} s timeout`
      : threadId === null
        ? "Codex did not start a thread"
        : setupResult === null
          ? "the agent ended before answering the setup message"
          : setupResult.isError
            ? "the setup turn ended with an error"
            : child.exitCode !== null
              ? "the agent ended right after the setup turn"
              : null;
    const task =
      setupFailure === null
        ? (await turn(invocation.prompt, invocation.timeoutMs)).turn
        : null;
    child.stdin.end();
    // The app server is stopped when it does not exit on its own once its input ends.
    linger = setTimeout(stopChild, exitGraceMs);
    const { exitCode, signal } = await closed;
    await readerClosed;
    await Promise.all([closeStream(transcript), closeStream(stderr)]);
    // An interrupted run is not a result: nothing is stored and a suite stops.
    if (interruptedBy)
      throw new Error(`The run was interrupted by ${interruptedBy}.`);
    return {
      exitCode,
      signal,
      setup,
      // A task Codex refused to start was never measured, so the run has no result.
      setupFailure:
        setupFailure ??
        (turnRefused ? "Codex refused to start the task turn" : null),
      task: turnRefused ? null : task,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      lines,
    };
  } finally {
    if (linger) clearTimeout(linger);
    if (forceKill) clearTimeout(forceKill);
    // The app server is gone, or the run failed: whatever is left of its process group,
    // an MCP server or a browser that ignored the first signal, goes with it.
    try {
      if (child.pid) signalProcessGroup(child.pid, "SIGKILL");
    } catch {
      // Nothing this process may signal is left: the run's outcome stands.
    }
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
  }
}
