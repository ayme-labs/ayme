import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { UserConfig } from "@commitlint/types";
import { RuleConfigSeverity } from "@commitlint/types";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const workspaceScopeRoots = ["apps", "packages"] as const;
const additionalScopes = ["skills"] as const;
const scopePattern = /^[a-z0-9-]+$/;

function loadWorkspaceScopes(): string[] {
  const scopes = new Set<string>();

  for (const workspaceRoot of workspaceScopeRoots) {
    const absoluteRoot = join(repoRoot, workspaceRoot);

    if (!existsSync(absoluteRoot) || !statSync(absoluteRoot).isDirectory()) {
      continue;
    }

    for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageJsonPath = join(absoluteRoot, entry.name, "package.json");
      if (!existsSync(packageJsonPath)) {
        continue;
      }

      if (!scopePattern.test(entry.name)) {
        throw new Error(
          `commitlint: workspace directory "${workspaceRoot}/${entry.name}" cannot be used as a scope. Use lowercase letters, numbers, and hyphens.`
        );
      }

      if (scopes.has(entry.name)) {
        throw new Error(
          `commitlint: duplicate workspace scope "${entry.name}" found under apps/ and packages/.`
        );
      }

      scopes.add(entry.name);
    }
  }

  return [...scopes].sort((left, right) => left.localeCompare(right));
}

// The allowed commit types and when to use each. AGENTS.md points here.
const commitTypes = {
  build: "Build system and package dependencies.",
  chore: "Maintenance that fits no other type.",
  ci: "CI workflows and their actions.",
  devex:
    "Internal material and tooling: AGENTS.md files, READMEs under apps/, ADRs, docs/agents/, docs/testing.md, docs/releasing.md and other internal docs, repo-local skills in .agents/skills/, Devbox, Lefthook hooks, this file and scripts/.",
  docs: "User-facing docs only: the consumer guide in docs/guide/ (the published site), the root README, the package READMEs that serve as npm entry points, and wording-only changes to the consumer skills in skills/. A change to a skill's behaviour is feat(skills) or fix(skills).",
  feat: "A new user-facing capability.",
  fix: "A user-facing bug fix.",
  refactor: "A code change that neither adds a capability nor fixes a bug.",
  style: "Formatting only, with no change in behaviour.",
  test: "Tests and test-only code.",
} as const;
const allowedTypes = Object.keys(commitTypes);
const workspaceScopes = [
  ...new Set([...loadWorkspaceScopes(), ...additionalScopes]),
].sort((left, right) => left.localeCompare(right));
const scopeRules: UserConfig["rules"] =
  workspaceScopes.length === 0
    ? {
        "scope-empty": [RuleConfigSeverity.Error, "always"],
      }
    : {
        "scope-enum": [RuleConfigSeverity.Error, "always", workspaceScopes],
      };

const config: UserConfig = {
  // Until the first release no change is marked as breaking. Remove this
  // plugin and its rule when the first release ships.
  plugins: [
    {
      rules: {
        "no-breaking-before-first-release": (commit) => [
          !(commit as { breaking?: string | null }).breaking &&
            !commit.notes.some((note) => note.title === "BREAKING CHANGE"),
          'no "!" or BREAKING CHANGE footer before the first release',
        ],
      },
    },
  ],
  parserPreset: {
    parserOpts: {
      headerCorrespondence: ["type", "scope", "breaking", "subject"],
      headerPattern: /^([a-z]+)(?:\(([a-z0-9-]+)\))?(!)?: (.+)$/,
    },
  },
  rules: {
    "header-max-length": [RuleConfigSeverity.Error, "always", 100],
    "header-trim": [RuleConfigSeverity.Error, "always"],
    "no-breaking-before-first-release": [RuleConfigSeverity.Error, "always"],
    "scope-case": [RuleConfigSeverity.Error, "always", "kebab-case"],
    ...scopeRules,
    "subject-empty": [RuleConfigSeverity.Error, "never"],
    "subject-full-stop": [RuleConfigSeverity.Error, "never", "."],
    "type-case": [RuleConfigSeverity.Error, "always", "lower-case"],
    "type-enum": [RuleConfigSeverity.Error, "always", allowedTypes],
  },
};

export default config;
