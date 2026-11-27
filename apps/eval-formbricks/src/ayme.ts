/**
 * What the arms with ayme need of the `ayme` command. The lab app is
 * unmodified Formbricks and ships no ayme: the lab app's folder is the
 * project a Session runs in, with its `ayme/page-objects.ts`, its own
 * `@ayme-dev/ayme` and Playwright, and the workspace's `@ayme-dev/cli`.
 *
 * The harness starts the run's Session before the measured window, the way
 * the guide connects ayme to each browser automation, and checks that it
 * lists the start screen's Page Object Tool. The agent gets the `ayme`
 * command on its PATH and the shipped `ayme` skill; nothing of ayme is in
 * the page.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import type { ArmContext } from "./arms.ts";
import { withoutClaudeVariables } from "./claude.ts";
import type { StartScreen } from "./missions.ts";
import { evalRoot, labRoot, repoRoot } from "./paths.ts";
import type { Precondition } from "./preconditions.ts";

const execFileAsync = promisify(execFile);

export const aymeCommandPackage = "@ayme-dev/cli";

/** Resolves a package as the Session does: from the lab app's folder, the project it runs in. */
const requireFromLab = createRequire(path.join(labRoot, "package.json"));

function resolvesFromLab(specifier: string): string | null {
  try {
    return requireFromLab.resolve(specifier);
  } catch {
    return null;
  }
}

/** The lab app's `@ayme-dev/cli` manifest; null until it is installed there. */
function commandManifest(): string | null {
  return resolvesFromLab(`${aymeCommandPackage}/package.json`);
}

/** The `ayme` command's file, as the package's `bin` names it; built by `pnpm lab:prepare`. */
export function aymeCommandPath(): string {
  const manifest = commandManifest();
  if (manifest === null)
    throw new Error(
      `${aymeCommandPackage} is not installed in apps/lab-formbricks.`
    );
  return path.join(path.dirname(manifest), "dist/cli.mjs");
}

export function aymeCommandVersion(): string {
  return (
    requireFromLab(`${aymeCommandPackage}/package.json`) as {
      version: string;
    }
  ).version;
}

/** The skill the arms with ayme load: the one this repository ships to consumers, so the eval measures that. */
export const aymeSkillName = "ayme";
export const aymeSkillSource = path.join(repoRoot, "skills", aymeSkillName);

/**
 * The skill's references the setup turn of every arm with ayme reads: how
 * the command reaches the browser, and how to read the screen and call a
 * Page Object Tool. Read there, they are in context before the measured
 * turn, as the spike's one-file skill was.
 */
export const aymeReferences = [
  "references/browser-automation-tools.md",
  "references/page-tools.md",
];

/** Where Claude Code loads user skills from, inside the run's configuration folder. */
export function aymeSkillDirectory(configDir: string) {
  return path.join(configDir, "skills", aymeSkillName);
}

/** Copies the shipped skill, references included, into the run's configuration folder; returns its folder. */
export async function installAymeSkill(configDir: string): Promise<string> {
  const skillDir = aymeSkillDirectory(configDir);
  await cp(aymeSkillSource, skillDir, { recursive: true });
  return skillDir;
}

function bashCommand(command: string) {
  return [`Bash(${command})`, `Bash(${command}:*)`];
}

/** The permission rules an arm with ayme adds to its browser automation's. */
export const aymeAllowedTools = ["Bash(ayme:*)", `Skill(${aymeSkillName})`];

/**
 * The `ayme` commands that stay denied: the setup started the run's Session,
 * which must last the run; `inspect` and `capture` open windows outside it;
 * `mcp` is an MCP server for an Agent App's chat, which waits on its stdin.
 */
export const aymeDisallowedTools = [
  "open",
  "attach",
  "close",
  "detach",
  "inspect",
  "capture",
  "mcp",
].flatMap((command) => bashCommand(`ayme ${command}`));

/** The run's own Session records, so no other run's command, nor a developer's own Session in the lab app's folder, is found. */
export function aymeCacheDirectory(runDir: string) {
  return path.join(runDir, "ayme-cache");
}

/** One line per `ayme` command the agent ran; see `aymeRecorder.mjs`. */
export function aymeRecordPath(runDir: string) {
  return path.join(runDir, "ayme-commands.jsonl");
}

export const aymeRecorderPath = path.join(evalRoot, "src/aymeRecorder.mjs");

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The `ayme` executable on the agent's PATH. It runs in the lab app's folder,
 * the project the Session belongs to, wherever the agent runs it: the
 * agent's working root is the Formbricks source, which has no
 * `ayme/page-objects.ts`. It finds the run's Session in the run's cache
 * folder and records itself.
 */
export function aymeShimScript(options: {
  runDir: string;
  commandPath: string;
}) {
  const variables = [
    `AYME_CACHE_DIR=${shellQuote(aymeCacheDirectory(options.runDir))}`,
    `EVAL_FORMBRICKS_AYME_RECORD=${shellQuote(aymeRecordPath(options.runDir))}`,
  ].join(" ");
  return `#!/bin/sh\ncd ${shellQuote(labRoot)} || exit 1\n${variables} exec ${shellQuote(process.execPath)} --import ${shellQuote(aymeRecorderPath)} ${shellQuote(options.commandPath)} "$@"\n`;
}

/** Writes the `ayme` executable into `shimDirectory`, which the arm puts first on the agent's PATH. */
export async function installAymeCommand(
  context: Pick<ArmContext, "runDir">,
  shimDirectory: string
): Promise<void> {
  await mkdir(shimDirectory, { recursive: true });
  const shim = path.join(shimDirectory, "ayme");
  await writeFile(
    shim,
    aymeShimScript({ runDir: context.runDir, commandPath: aymeCommandPath() })
  );
  await chmod(shim, 0o755);
}

/** The command must be built, and so must the `@ayme-dev/ayme` the Session runs the lab app's Page Objects with. */
const aymeCommandBuilt: Precondition = {
  name: "ayme command",
  check: () => {
    const prepare = "Run pnpm lab:prepare in apps/lab-formbricks.";
    if (commandManifest() === null)
      return `${aymeCommandPackage} is not installed in apps/lab-formbricks. Run pnpm install, then pnpm lab:prepare there.`;
    if (!existsSync(aymeCommandPath()))
      return `${aymeCommandPackage} is not built: ${aymeCommandPath()} is missing. ${prepare}`;
    for (const entry of ["compiler", "internal"])
      if (resolvesFromLab(`@ayme-dev/ayme/${entry}`) === null)
        return `@ayme-dev/ayme, which the Session runs the lab app's Page Objects with, is not built. ${prepare}`;
    return null;
  },
};

/** `ayme open` starts Chromium with the project's Playwright, which needs its own browser build. */
const chromiumForOpen: Precondition = {
  name: "Chromium for ayme open",
  check: () => {
    let executable: string;
    try {
      executable = (
        requireFromLab("@playwright/test") as {
          chromium: { executablePath(): string };
        }
      ).chromium.executablePath();
    } catch (error) {
      return `The lab app's Playwright did not load: ${error instanceof Error ? error.message : String(error)}`;
    }
    return existsSync(executable)
      ? null
      : `The lab app's Playwright has no Chromium at ${executable}, which ayme open starts. Run pnpm exec playwright install chromium in apps/lab-formbricks.`;
  },
};

/** Shared objects, so a suite checks each once. */
export const aymePreconditions: Precondition[] = [aymeCommandBuilt];
export const aymeOpenPreconditions: Precondition[] = [
  aymeCommandBuilt,
  chromiumForOpen,
];

/**
 * A Page Object Tool each start screen offers: proof that the Session is on
 * that screen with the lab app's Page Objects.
 */
export const startScreenTool: Record<StartScreen, string> = {
  editor: "SurveyEditorPage.fillSurveyForm",
  "sign-in": "SignInPage.logIn",
};

/** The Page Object Tools `ayme tools` lists: each tool's line starts with its `<class>.<action>` name. */
export function listedToolNames(output: string): string[] {
  return output.split("\n").flatMap((line) => {
    const name = /^([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)[\s:]/.exec(line)?.[1];
    return name === undefined ? [] : [name];
  });
}

/** The address `ayme open --json` prints for the browser automation to attach to. */
export function openedAddress(output: string): string {
  const answer = JSON.parse(output) as { data?: { address?: unknown } };
  const address = answer.data?.address;
  if (typeof address !== "string")
    throw new Error(`ayme open printed no address: ${output}`);
  return address;
}

/**
 * Runs the `ayme` command as the harness, outside the agent's recording: in
 * the lab app's folder, with the run's cache folder, in an environment
 * without the launcher's Claude Code variables or token, which the
 * Session's background process inherits.
 */
async function runAyme(context: Pick<ArmContext, "runDir">, args: string[]) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [aymeCommandPath(), ...args],
    {
      cwd: labRoot,
      env: {
        ...withoutClaudeVariables(process.env),
        AYME_CACHE_DIR: aymeCacheDirectory(context.runDir),
      },
      timeout: 120_000,
    }
  );
  return stdout;
}

/** What the setup established before the measured window, recorded in the result. */
export type AymeEvidence = {
  ayme: {
    name: string;
    version: string;
    /** The command that started the Session. */
    started: string[];
    /** The browser's address the Session is connected to. */
    address: string;
    /** The Page Object Tools `ayme tools` listed on the start screen. */
    tools: string[];
  };
};

/** A Session the harness started: how to tell it is on the start screen, and how to end it. */
export type HarnessSession = {
  address: string;
  /** Resolves once `ayme tools` lists the start screen's Page Object Tool. */
  onStartScreen: () => Promise<AymeEvidence>;
  /** `ayme close` for a Session `ayme open` started, `ayme detach` for one `ayme attach` started; never throws. */
  end: () => Promise<void>;
};

/**
 * Starts the run's Session: `ayme open`, which opens the browser, or `ayme
 * attach --cdp=<address>` to the browser the automation opened.
 */
export async function startAymeSession(
  context: Pick<ArmContext, "runDir" | "start" | "log">,
  how: { open: true } | { attach: string }
): Promise<HarnessSession> {
  const started =
    "open" in how ? ["open", "--json"] : ["attach", `--cdp=${how.attach}`];
  context.log(`Starting the ayme Session: ayme ${started.join(" ")}.`);
  const output = await runAyme(context, started);
  const address = "open" in how ? openedAddress(output) : how.attach;
  const end = async () => {
    try {
      await runAyme(context, ["open" in how ? "close" : "detach"]);
    } catch (error) {
      context.log(
        `Ending the ayme Session failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  const onStartScreen = async (): Promise<AymeEvidence> => {
    const screenTool = startScreenTool[context.start.screen];
    const deadline = Date.now() + 60_000;
    let tools: string[] = [];
    while (!tools.includes(screenTool)) {
      if (Date.now() > deadline)
        throw new Error(
          `The ayme Session did not list ${screenTool} within 60 s. It listed ${tools.join(", ") || "nothing"}.`
        );
      tools = listedToolNames(await runAyme(context, ["tools"]));
      if (!tools.includes(screenTool))
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    context.log(`The ayme Session lists ${tools.join(", ")}.`);
    return {
      ayme: {
        name: aymeCommandPackage,
        version: aymeCommandVersion(),
        started,
        address,
        tools,
      },
    };
  };
  return { address, onStartScreen, end };
}
