/**
 * Spike: the arms that reach Ayme's Page Object Tools through the `ayme`
 * command instead of `ayme mcp` or WebMCP. The lab app ships no Ayme and the
 * browser loads no init script: a background process of `@ayme-dev/mcp`
 * attaches over CDP to the browser the arm's automation drives, takes the
 * tab the setup marked, and runs the lab app's Page Objects in Node. The
 * agent gets the `ayme` command on its PATH and the instruction text in
 * `spike/ayme-cli/SKILL.md` as a skill.
 *
 * The command's names and arguments are the spike's placeholders. These arms
 * stay out of a suite's default arms.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import type { ArmContext } from "./arms.ts";
import {
  aymeMcpCliPath,
  aymeMcpPackageName,
  aymeMcpVersion,
  isPageObjectToolName,
  startScreenTool,
} from "./ayme.ts";
import { withoutClaudeVariables } from "./claude.ts";
import { evalRoot, labRoot } from "./paths.ts";
import type { Precondition } from "./preconditions.ts";

const execFileAsync = promisify(execFile);

/** The skill these arms load: the instruction text for this channel, kept in this package. */
export const aymeCliSkillName = "ayme-cli";
export const aymeCliSkillSource = path.join(
  evalRoot,
  "spike",
  aymeCliSkillName
);

/** The lab app's Page Objects entry, outside the agent's working root. */
export const labPageObjectsEntry = path.join(labRoot, ".ayme/page-objects.ts");

/** The global the mark is written to, as the background process reads it. */
export const markGlobal = "__aymeMark";

/** What the arm's interface line adds to its browser automation's: where the Page Object Tools are, as a fact. */
export const aymeCliSentence =
  "The `ayme` command, attached to this tab, lists and calls the Page Object Tools of the screen the browser is on; start from `ayme tools`.";

function bashCommand(command: string) {
  return [`Bash(${command})`, `Bash(${command}:*)`];
}

/** The permission rules these arms add to their browser automation's. */
export const aymeCliAllowedTools = [
  "Bash(ayme:*)",
  `Skill(${aymeCliSkillName})`,
];

/**
 * The `ayme` commands that stay denied: the setup attached the process with
 * the lab app's entry, which the agent cannot name, and it must outlive the
 * run; `mcp` and `inspect` are another channel's.
 */
export const aymeCliDisallowedTools = [
  ...bashCommand("ayme attach"),
  ...bashCommand("ayme detach"),
  ...bashCommand("ayme mcp"),
  ...bashCommand("ayme inspect"),
];

/** Where Claude Code loads the skill from, inside the run's configuration folder. */
export function aymeCliSkillDirectory(configDir: string) {
  return path.join(configDir, "skills", aymeCliSkillName);
}

/** Copies the instruction text into the run's configuration folder; returns its folder. */
export async function installAymeCliSkill(configDir: string): Promise<string> {
  const skillDir = aymeCliSkillDirectory(configDir);
  await cp(aymeCliSkillSource, skillDir, { recursive: true });
  return skillDir;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A one-line `ayme` executable: the workspace's built command, and nothing else of the package. */
export function aymeCliShimScript() {
  return `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(aymeMcpCliPath)} "$@"\n`;
}

/** Writes the `ayme` command into `shimDirectory`, which the arm puts first on the agent's PATH. */
export async function installAymeCli(shimDirectory: string): Promise<void> {
  await mkdir(shimDirectory, { recursive: true });
  const shim = path.join(shimDirectory, "ayme");
  await writeFile(shim, aymeCliShimScript());
  await chmod(shim, 0o755);
}

/**
 * What the `ayme` command reads from the environment: the run's own cache
 * folder, so its record of the background process sits in the run folder and
 * no other run's command finds it.
 */
export function aymeCliEnvironment(
  context: Pick<ArmContext, "runDir">
): Record<string, string> {
  return { AYME_CACHE_DIR: path.join(context.runDir, "ayme-cache") };
}

/** The start command as the harness runs it: the instruction text's, with the lab app's entry. */
export function aymeAttachArgs(endpoint: string, mark: string): string[] {
  return [
    "attach",
    "--cdp",
    endpoint,
    "--mark",
    mark,
    "--page-objects",
    labPageObjectsEntry,
  ];
}

/** The token the setup marks the start page's tab with. */
export function markOf(runId: string) {
  return `eval-${runId.slice(-6)}`;
}

/** The names `ayme tools` prints: one per line that starts with a Page Object Tool's name. */
export function toolNamesOf(output: string): string[] {
  return output
    .split("\n")
    .map((line) => /^([^\s:]+)/.exec(line)?.[1])
    .filter(
      (name): name is string => name !== undefined && isPageObjectToolName(name)
    );
}

/** Resolves a package as the background process does: from the lab app's `.ayme` folder. */
const requireFromLab = createRequire(path.join(labRoot, "package.json"));

function resolvesFromLab(specifier: string): boolean {
  try {
    requireFromLab.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

/** The command must be built, and so must the `@ayme-dev/ayme` it compiles and runs the Page Objects with. */
export const aymeCliPreconditions: Precondition[] = [
  {
    name: "Ayme command",
    check: () => {
      if (!existsSync(aymeMcpCliPath))
        return `${aymeMcpPackageName} is not built: ${aymeMcpCliPath} is missing. Run pnpm lab:prepare in apps/lab-formbricks.`;
      for (const entry of ["compiler", "playwright"])
        if (!resolvesFromLab(`@ayme-dev/ayme/${entry}`))
          return `@ayme-dev/ayme, which the ayme command compiles and runs the lab app's Page Objects with, is not built. Run pnpm lab:prepare in apps/lab-formbricks.`;
      return null;
    },
  },
];

/** What the setup established before the measured window, recorded in the result. */
export type AymeCliEvidence = {
  aymeCli: {
    name: string;
    version: string;
    args: string[];
    /** From setting the mark to the process answering. */
    attachMs: number;
    attached: string;
    /** The Page Object Tools `ayme tools` printed on the start screen. */
    tools: string[];
  };
};

/**
 * Marks the start page's tab through the arm's own automation (`setMark`),
 * starts the background process in the agent's working root, attached to
 * the browser at `endpoint`, and waits until it offers the start screen's
 * Page Object Tool. `environment` is the agent's, with the `ayme` command on
 * its PATH. Stops the process when it fails.
 */
export async function attachAymeCli(
  context: Pick<ArmContext, "runId" | "cwd" | "start" | "log">,
  environment: Record<string, string>,
  options: {
    /** Where the setup wrote the `ayme` command. */
    shimDirectory: string;
    endpoint: string;
    setMark: (token: string) => Promise<unknown>;
  }
): Promise<{ evidence: AymeCliEvidence; dispose: () => Promise<void> }> {
  const ayme = async (args: string[]) => {
    // The agent's working directory: the command finds its process by the folder it runs in.
    const command = path.join(options.shimDirectory, "ayme");
    const { stdout } = await execFileAsync(command, args, {
      cwd: context.cwd,
      env: { ...withoutClaudeVariables(process.env), ...environment },
      timeout: 120_000,
    });
    return stdout;
  };
  const dispose = async () => {
    try {
      await ayme(["detach"]);
    } catch (error) {
      context.log(
        `Stopping the ayme background process failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  const mark = markOf(context.runId);
  const args = aymeAttachArgs(options.endpoint, mark);
  const started = Date.now();
  await options.setMark(mark);
  const attached = (await ayme(args)).trim();
  const attachMs = Date.now() - started;
  try {
    const screenTool = startScreenTool[context.start.screen];
    const deadline = Date.now() + 60_000;
    let tools: string[] = [];
    while (!tools.includes(screenTool)) {
      if (Date.now() > deadline)
        throw new Error(
          `The ayme command did not offer ${screenTool} within 60 s. It offered ${tools.join(", ") || "nothing"}.`
        );
      // Reading the tree makes the process look at the page, so its tools are those of the screen now.
      await ayme(["page-objects"]);
      tools = toolNamesOf(await ayme(["tools"]));
      if (!tools.includes(screenTool))
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    context.log(
      `${attached} ${attachMs} ms after the mark; ayme tools lists ${tools.join(", ")}.`
    );
    return {
      evidence: {
        aymeCli: {
          name: aymeMcpPackageName,
          version: aymeMcpVersion(),
          args,
          attachMs,
          attached,
          tools,
        },
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
