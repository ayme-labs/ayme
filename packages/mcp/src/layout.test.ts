import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const eslint = new ESLint({ cwd: packageRoot });

/** The lint messages for `code` as if it were the file at `path`. */
async function lint(path: string, code: string) {
  const [result] = await eslint.lintText(code, {
    filePath: join(packageRoot, path),
  });
  return result!.messages.map(({ message }) => message);
}

// ESLint loads the package config and its import resolver on first use.
it(
  "lint flags an import against the slice and layer layout",
  { timeout: 60_000 },
  async () => {
    expect(
      await lint(
        "src/pairing/domain/misplaced.ts",
        'export { listenOnFirstFreePort } from "../infrastructure/firstFreePort";\n'
      )
    ).toEqual([
      expect.stringContaining(
        "domain may only depend on the allowed horizontal layers"
      ),
    ]);
    expect(
      await lint(
        "src/client/misplaced.ts",
        'export { startMcpServer } from "../server";\n'
      )
    ).toEqual([expect.stringContaining("client may only use")]);
    expect(
      await lint(
        "src/tools/application/misplaced.ts",
        'export { AgentConnection } from "../../connection/application/agentConnection";\n'
      )
    ).toEqual([
      expect.stringContaining("Import another slice through its index.ts."),
    ]);
  }
);
