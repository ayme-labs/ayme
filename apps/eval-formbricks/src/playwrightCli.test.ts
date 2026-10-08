import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parsePageUrl,
  playwrightCliEnvironment,
  playwrightCliRoot,
  shimDirectory,
  shimScript,
  skillDirectory,
} from "./playwrightCli.ts";

const context = {
  runId: "run-1",
  runDir: "/run",
  profileDir: "/run/browser-profile",
  outputDir: "/run/playwright-output",
};

describe("the Playwright CLI environment", () => {
  const environment = playwrightCliEnvironment(context, "/usr/bin:/bin");

  it("puts the run's CLI first on the PATH and names the run's session", () => {
    expect(environment.PATH).toBe("/run/bin:/usr/bin:/bin");
    expect(environment.PLAYWRIGHT_CLI_SESSION).toBe("run-1");
  });

  it("points the session at the signed-in profile and the run's output folder, on the system Chrome", () => {
    expect(environment).toMatchObject({
      PLAYWRIGHT_MCP_BROWSER: "chrome",
      PLAYWRIGHT_MCP_USER_DATA_DIR: "/run/browser-profile",
      PLAYWRIGHT_MCP_OUTPUT_DIR: "/run/playwright-output",
    });
  });

  it("keeps the page's WebMCP tools and the update check off", () => {
    expect(environment.PLAYWRIGHT_MCP_WEBMCP).toBe("false");
    expect(environment.NO_UPDATE_NOTIFIER).toBe("1");
  });

  it("holds a CLI shim in a folder of its own", () => {
    expect(shimDirectory("/run")).toBe("/run/bin");
    expect(shimScript()).toMatch(
      /^#!\/bin\/sh\nexec '.+' '.+\/@playwright\/cli\/playwright-cli\.js' "\$@"\n$/
    );
  });
});

describe("parsePageUrl", () => {
  it("reads the page URL from a command's output", () => {
    expect(
      parsePageUrl(
        "### Page\n- Page URL: http://localhost:3000/workspaces/w/surveys/s/edit\n- Page Title: Survey\n"
      )
    ).toBe("http://localhost:3000/workspaces/w/surveys/s/edit");
  });

  it("is null when the output names no page", () => {
    expect(parsePageUrl("### Error\nsomething broke\n")).toBeNull();
  });
});

describe("the official skill", () => {
  it("ships in the pinned package under the name the arm allows", () => {
    const skill = readFileSync(
      path.join(playwrightCliRoot, "skills/playwright-cli/SKILL.md"),
      "utf8"
    );
    expect(skill).toMatch(/^---\nname: playwright-cli\n/);
    expect(skillDirectory("/run/claude-config")).toBe(
      "/run/claude-config/skills/playwright-cli"
    );
  });
});
