/**
 * The worker's project: the fixture project with the ref's `@ayme-dev/ayme`,
 * the ref's `ayme` skill and guide, and an .npmrc that installs from the
 * run's registry. It has no `@ayme-dev/cli`: the worker installs the
 * command.
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Packed } from "./pack.ts";
import { projectTemplateDir } from "./paths.ts";

export function buildProject(
  project: string,
  packed: Pick<Packed, "dir" | "version">,
  registryUrl: string
): void {
  cpSync(projectTemplateDir, project, { recursive: true });
  const template = join(project, "package.json.template");
  writeFileSync(
    join(project, "package.json"),
    readFileSync(template, "utf8").replaceAll(
      "{{AYME_VERSION}}",
      packed.version
    )
  );
  rmSync(template);
  writeFileSync(join(project, ".npmrc"), `registry=${registryUrl}\n`);
  cpSync(
    join(packed.dir, "skill"),
    join(project, ".claude", "skills", "ayme"),
    {
      recursive: true,
    }
  );
  cpSync(join(packed.dir, "docs"), join(project, "ayme-docs"), {
    recursive: true,
  });
}
