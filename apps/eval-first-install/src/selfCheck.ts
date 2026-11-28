/**
 * Does the task with no agent, the way the guide's Connect an agent page
 * sets a project up: installs `@ayme-dev/cli` with a bare `npm install`,
 * installs Chromium for the project's Playwright, starts a Session with
 * `ayme open`, and calls the Page Object Tools with `ayme call`. It proves
 * the packed packages, the registry, the fixture app, the recorder and the
 * outcome check fit together before any model is paid for.
 */
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Answer = { code: number; stdout: string; stderr: string };

/** The id `ayme page-objects` gives the ListItem whose name reads `name`. */
function itemId(tree: string, name: string): string {
  const lines = tree.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = /ListItem (po\d+)/.exec(lines[i]!);
    if (!match) continue;
    for (
      let j = i + 1;
      j < lines.length && !/ListItem po\d+/.test(lines[j]!);
      j += 1
    ) {
      if (lines[j]!.includes(`"${name}"`)) return match[1]!;
    }
  }
  throw new Error(`No ListItem named ${name} in:\n${tree}`);
}

/**
 * Resolves with the number of `ayme` commands it ran, which the recording
 * must hold.
 */
export async function selfCheck(
  project: string,
  page: string,
  n: string,
  version: string,
  env: NodeJS.ProcessEnv,
  log: (line: string) => void
): Promise<number> {
  const npm = (args: string[]) =>
    execFileSync("npm", args, { cwd: project, env, stdio: "inherit" });
  npm(["install", "--save-dev", "--no-audit", "--no-fund", "@ayme-dev/cli"]);
  const installed = JSON.parse(
    readFileSync(
      join(project, "node_modules", "@ayme-dev", "cli", "package.json"),
      "utf8"
    )
  ).version;
  if (installed !== version)
    throw new Error(
      `npm install @ayme-dev/cli installed ${installed}, not the packed ${version}`
    );
  execFileSync("npx", ["playwright", "install", "chromium"], {
    cwd: project,
    env,
    stdio: "inherit",
  });

  let commands = 0;
  const ayme = (...args: string[]) =>
    new Promise<Answer>((resolve) => {
      commands += 1;
      execFile(
        "npx",
        ["ayme", ...args],
        { cwd: project, env },
        (error, stdout, stderr) => {
          const code = error ? Number(error.code ?? 1) : 0;
          log(`ayme ${args.join(" ")} -> ${code}\n${stdout}${stderr}`);
          resolve({ code, stdout, stderr });
        }
      );
    });
  const succeeds = async (...args: string[]) => {
    const answer = await ayme(...args);
    if (answer.code !== 0)
      throw new Error(`ayme ${args.join(" ")} failed: ${answer.stderr}`);
    return answer.stdout;
  };
  const call = (tool: string, params: object) =>
    succeeds("call", tool, "--params", JSON.stringify(params));

  await succeeds("open", page);
  try {
    await succeeds("page-objects");
    await call("ListPage.addItem", { text: `Oat milk ${n}` });
    await call("ListPage.addItem", { text: `Rye bread ${n}` });
    let tree = await succeeds("page-objects");
    await call("ListItem.rename", {
      id: itemId(tree, `Oat milk ${n}`),
      args: { text: `Soy milk ${n}` },
    });
    tree = await succeeds("page-objects");
    await call("ListItem.archive", { id: itemId(tree, `Rye bread ${n}`) });
    await succeeds("page-objects");
  } finally {
    // Closes the browser `ayme open` started, also after a failed call.
    await ayme("close");
  }
  return commands;
}
