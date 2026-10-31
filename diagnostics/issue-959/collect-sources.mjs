// Public GitHub evidence only. Never captures environment or pairing links.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const run = (command, args) =>
  execFileSync(command, args, { encoding: "utf8" }).trim();
const gh = (...args) => JSON.parse(run("gh", args));
const head = run("git", ["rev-parse", "HEAD"]);
const remote = gh("api", "repos/ayme-labs/ayme/commits/main").sha;
const comparison = gh(
  "api",
  `repos/ayme-labs/ayme/compare/${head}...${remote}`
);
const output = {
  collectedAt: new Date().toISOString(),
  head,
  remote,
  comparison: {
    ahead: comparison.ahead_by,
    behind: comparison.behind_by,
    commits: comparison.commits.map((c) => ({
      sha: c.sha,
      subject: c.commit.message.split("\n")[0],
    })),
    files: comparison.files.map((f) => f.filename),
    executionRelatedPatches: comparison.files
      .filter((f) =>
        /runtime\/runtime\.ts|pomRegistry\.ts|pageStateSession\.ts|pageCapture\.ts|actionTool\.ts/.test(
          f.filename
        )
      )
      .map(({ filename, patch }) => ({ filename, patch })),
  },
  issues: [959, 962].map((number) =>
    gh(
      "issue",
      "view",
      String(number),
      "--repo",
      "ayme-labs/ayme",
      "--json",
      "number,title,body,comments,state,closedAt,url"
    )
  ),
  fix: gh(
    "pr",
    "view",
    "987",
    "--repo",
    "ayme-labs/ayme",
    "--json",
    "number,title,body,comments,mergeCommit,mergedAt,url"
  ),
  formbricks: {
    reportPin: "211ad704de30aabf96c059cc1cf00391d5b63a27",
    currentPin: "bf06fa583733c61334ede3e13b311fb9d89644af",
    comparison: gh(
      "api",
      "repos/ayme-labs/formbricks/compare/211ad704de30aabf96c059cc1cf00391d5b63a27...bf06fa583733c61334ede3e13b311fb9d89644af",
      "--jq",
      "{ahead_by,files:[.files[].filename]}"
    ),
    component:
      "apps/web/modules/survey/list/components/survey-dropdown-menu.tsx",
    wrapper: "apps/web/modules/ui/components/dropdown-menu/index.tsx",
  },
  lite: {
    reportPin: "b8e667f2f4b54896ad3059964fbde993fbacc9eb",
    currentPin: "2b8849cfb31714353d94e6a33095ac3aa5b898bb",
    comparison: gh(
      "api",
      "repos/ayme-labs/playwright-lite/compare/b8e667f2f4b54896ad3059964fbde993fbacc9eb...2b8849cfb31714353d94e6a33095ac3aa5b898bb",
      "--jq",
      '{status,files:[.files[].filename],pagePatch:[.files[]|select(.filename=="src/page.ts")|.patch]}'
    ),
  },
};
writeFileSync(
  new URL("./evidence/sources.json", import.meta.url),
  JSON.stringify(output, null, 2) + "\n"
);
console.log(
  `Saved public sources; remote main ${remote}, ${comparison.ahead_by} commits ahead.`
);
