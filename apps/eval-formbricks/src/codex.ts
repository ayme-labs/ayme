/**
 * Runs Codex as the agent, through `codex app-server` over stdio: one
 * process and one thread for the setup message and the task, as with Claude
 * Code, so the arm's MCP servers start once, before the measured turn.
 * `codex exec resume` would start them again inside it.
 *
 * Every arm runs on it, set up as for Claude Code. Codex has no per-tool
 * permission rules, so an arm's are carried over in Codex's own terms:
 * - the read-only file tools become a shell whose commands read only the
 *   agent's working root, the arm's skills and the folders the arm names,
 *   write nothing and reach no network;
 * - a command the arm allows, its browser automation's command line, runs
 *   outside that sandbox, and one the arm denies is refused;
 * - a skill is a folder the agent reads with that shell, where Claude Code
 *   has a Skill tool; the arm installs it in the same place for both.
 * What Codex adds on its own is switched off.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  setupTurnFailure,
  startAgentProcess,
  type Turn,
} from "./agentProcess.ts";
import type { Arm, McpServer } from "./arms.ts";
import { agentEffort, setupTimeoutMs, type ClaudeRun } from "./claude.ts";
import { turnCompleted } from "./codexTranscript.ts";
import { codexTokenVariable, envFileName } from "./environment.ts";
import type { Precondition } from "./preconditions.ts";

export const codexDefaultModel = "gpt-6-luna";

/** How long the app server may take to exit once its input is closed before it is stopped. */
const exitGraceMs = 5_000;

/**
 * What Codex gives an agent beyond the arm's interface, each switched off:
 * the apps connected to the signed-in account, which arrive even in a fresh
 * configuration folder, plugins, subagents, and the rest.
 */
const featuresOff = [
  "apps",
  "plugins",
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

/** The permission profile of the run's configuration. */
const permissionProfile = "eval";

/** A TOML basic string; JSON's escapes are TOML's. */
const toml = (value: string) => JSON.stringify(value);

/**
 * The run's `config.toml`: the model and effort, no approval question ever
 * asked, no project instructions read from the agent's working root, no web
 * search, none of the skills Codex ships with, a shell that reads only the
 * folders in `readable`, and the arm's MCP servers with every tool of theirs
 * approved. A command and an MCP server keep the user's real home folder,
 * which the agent itself does not get (see `codexEnvironment`): the arm's
 * command line finds the session the harness opened for it there.
 */
export function codexConfig(options: {
  model: string;
  mcpServers: Record<string, McpServer>;
  /** The folders the agent's commands may read: its working root, the arm's skills, and what the arm's setup names. */
  readable: string[];
  /** The home folder commands and MCP servers run with; the user's own by default. */
  home?: string;
}) {
  const home = options.home ?? os.homedir();
  return [
    `model = ${toml(options.model)}`,
    `model_reasoning_effort = ${toml(agentEffort)}`,
    'approval_policy = "never"',
    `default_permissions = ${toml(permissionProfile)}`,
    "project_doc_max_bytes = 0",
    'web_search = "disabled"',
    "",
    "[agents]",
    "enabled = false",
    "",
    "[skills.bundled]",
    "enabled = false",
    "",
    "[shell_environment_policy]",
    `set = { HOME = ${toml(home)} }`,
    "",
    // No folder of the run is writable and no network is granted; `:minimal` is what a command needs
    // to start at all. On a Mac the sandbox opens the temporary folders, `/private/tmp` and
    // `/private/var/tmp`, for reading and writing whatever is listed here. Denying them is no way
    // out: with a denied folder Codex runs every command in the sandbox, the arm's own too.
    // What a command leaves there cannot leave the sandbox: see `codexRules`.
    `[permissions.${permissionProfile}.filesystem]`,
    '":minimal" = "read"',
    ...options.readable.map((folder) => `${toml(folder)} = "read"`),
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

/** The words of the command a `Bash(...)` permission rule names, or `null` for a rule of another tool. */
function ruleCommand(rule: string): string[] | null {
  const command = /^Bash\((.+?)(:\*)?\)$/.exec(rule)?.[1];
  return command === undefined ? null : command.split(/\s+/);
}

/**
 * The arm's command-line permissions as Codex's rules file: a command the
 * arm allows runs outside the sandbox, as it must to reach its browser, and
 * one it denies is refused, also when it starts with an allowed one. Every
 * other command runs in the sandbox. Rules for a skill or an MCP server need
 * none: the skill is a folder the agent may read, and the configuration
 * approves the arm's MCP servers.
 *
 * An allowed command is the file of that name on the agent's `searchPath`
 * and no other. Without that, Codex lets a file of the same name anywhere
 * out of the sandbox when it is called by its path, and a sandboxed command
 * can write one to the temporary folders. Throws when the arm allows a
 * command that is not there.
 */
export function codexRules(
  arm: Pick<Arm, "allowedTools" | "disallowedTools">,
  searchPath: string
): string {
  const allowed = [
    ...new Set(
      arm.allowedTools
        .map(ruleCommand)
        .flatMap((command) => (command?.[0] === undefined ? [] : [command[0]]))
    ),
  ];
  const executables = allowed.map((name) => {
    const file = searchPath
      .split(path.delimiter)
      .map((folder) => path.join(folder, name))
      .find((candidate) => existsSync(candidate));
    if (file === undefined)
      throw new Error(
        `The arm allows the \`${name}\` command, which is not on the agent's PATH.`
      );
    return `host_executable(name=${toml(name)}, paths=[${toml(file)}])`;
  });
  const rules = (permissions: string[], decision: string) => [
    ...new Set(
      permissions
        .map(ruleCommand)
        .filter((command) => command !== null)
        .map(
          (command) =>
            `prefix_rule(pattern=[${command.map(toml).join(", ")}], decision=${toml(decision)})`
        )
    ),
  ];
  return [
    ...executables,
    ...rules(arm.allowedTools, "allow"),
    ...rules(arm.disallowedTools ?? [], "forbidden"),
    "",
  ].join("\n");
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
  const startedAt = new Date();
  const answers = new Map<number, (answer: Json) => void>();
  const agent = startAgentProcess({
    command: "codex",
    args: ["app-server", "--strict-config"],
    cwd: invocation.cwd,
    environment: invocation.environment,
    transcriptPath: invocation.transcriptPath,
    stderrPath: invocation.stderrPath,
    onLine: (line) => {
      let message: Json;
      try {
        message = JSON.parse(line) as Json;
      } catch {
        message = {};
      }
      if (
        typeof message.method === "string" &&
        message.method.endsWith("/delta")
      )
        return false;
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
      if (completed !== null) agent.completeTurn(completed);
      return true;
    },
  });
  const send = (message: Json) => agent.write(`${JSON.stringify(message)}\n`);

  let nextId = 1;
  /** Sends a request and waits for its answer; `null` when the agent ended first. */
  const request = (method: string, params: Json) =>
    new Promise<Json | null>((resolve) => {
      const id = nextId++;
      answers.set(id, resolve);
      send({ id, method, params });
      void agent.ended.then(() => resolve(null));
    });

  let threadId: string | null = null;
  let turnRefused = false;
  /** Sends one message as a turn and waits for its end, the turn's timeout or the agent's end. */
  const turn = (text: string, timeoutMs: number) =>
    agent.turn(timeoutMs, () => {
      void request("turn/start", {
        threadId,
        input: [{ type: "text", text }],
      }).then((answer) => {
        // A turn the server refused to start never completes.
        if (answer !== null && answer.error !== undefined) {
          turnRefused = true;
          agent.completeTurn({ isError: true });
        }
      });
    });

  try {
    const setupTimeout = invocation.setupTimeoutMs ?? setupTimeoutMs;
    // Starting up is the setup turn's: its clock starts before the thread exists.
    const setupSentAt = Date.now();
    let startTimedOut = false;
    // A server that never answers ends with the setup turn's timeout too.
    const startTimer = setTimeout(() => {
      startTimedOut = true;
      agent.stop();
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

    // A start that outlasted the timeout sends no setup message, even to a server that then answers.
    const setupTurn =
      threadId === null || startTimedOut
        ? {
            turn: { sentAt: "", wallTimeMs: null, timedOut: startTimedOut },
            result: null,
          }
        : await turn(
            invocation.setupPrompt,
            Math.max(0, setupTimeout - (Date.now() - setupSentAt))
          );
    const setup: Turn = {
      sentAt: new Date(setupSentAt).toISOString(),
      wallTimeMs:
        setupTurn.turn.wallTimeMs === null ? null : Date.now() - setupSentAt,
      timedOut: setupTurn.turn.timedOut,
    };
    const setupFailure =
      threadId === null && !setup.timedOut
        ? "Codex did not start a thread"
        : setupTurnFailure(
            agent,
            { turn: setup, result: setupTurn.result },
            setupTimeout
          );
    const task =
      setupFailure === null
        ? (await turn(invocation.prompt, invocation.timeoutMs)).turn
        : null;
    // The app server is stopped when it does not exit on its own once its input ends.
    const { exitCode, signal } = await agent.finish(exitGraceMs);
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
      lines: agent.lines,
    };
  } finally {
    agent.dispose();
  }
}
