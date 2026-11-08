import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  agentBrowserEnvironment,
  agentBrowserRoot,
  agentBrowserVersion,
  nativeBinary,
  shimDirectory,
  shimScript,
  skillDirectory,
  socketDirectory,
} from "./agentBrowser.ts";

const context = {
  runId: "run-abc123",
  runDir: "/run",
  outputDir: "/run/playwright-output",
};

describe("the agent-browser environment", () => {
  const environment = agentBrowserEnvironment(context, "/usr/bin:/bin", {
    cdpPort: 9222,
    webmcp: false,
  });

  it("puts the run's command first on the PATH and names the run's session", () => {
    expect(environment.PATH).toBe("/run/bin:/usr/bin:/bin");
    expect(environment.AGENT_BROWSER_SESSION).toBe("run-abc123");
  });

  it("attaches every session to the harness's browser over CDP, keeps its sockets apart from other runs' and its screenshots in the run's output folder", () => {
    expect(environment).toMatchObject({
      AGENT_BROWSER_CDP: "9222",
      AGENT_BROWSER_SOCKET_DIR: path.join(
        os.tmpdir(),
        "agent-browser-eval-abc123"
      ),
      AGENT_BROWSER_SCREENSHOT_DIR: "/run/playwright-output",
    });
    expect(socketDirectory("run-abc123")).toBe(
      environment.AGENT_BROWSER_SOCKET_DIR
    );
  });

  it("never names a browser, a profile or anything else that would launch one", () => {
    for (const name of [
      "AGENT_BROWSER_EXECUTABLE_PATH",
      "AGENT_BROWSER_PROFILE",
      "AGENT_BROWSER_AUTO_CONNECT",
      "AGENT_BROWSER_PROVIDER",
    ])
      expect(Object.keys(environment)).not.toContain(name);
  });

  it("keeps the page's WebMCP tools and the outdated-Chrome check off", () => {
    expect(environment.AGENT_BROWSER_NO_WEBMCP).toBe("1");
    expect(environment.AGENT_BROWSER_NO_VERSION_CHECK).toBe("1");
  });

  it("turns the page's WebMCP tools on when asked and changes nothing else", () => {
    const withWebMcp = agentBrowserEnvironment(context, "/usr/bin:/bin", {
      cdpPort: 9222,
      webmcp: true,
    });
    expect(withWebMcp).toEqual({
      ...environment,
      AGENT_BROWSER_NO_WEBMCP: undefined,
    });
    expect(Object.keys(withWebMcp)).not.toContain("AGENT_BROWSER_NO_WEBMCP");
  });
});

describe("the agent-browser command", () => {
  it("is a shim in a folder of its own that runs the package's native binary", () => {
    expect(shimDirectory("/run")).toBe("/run/bin");
    expect(shimScript("/pkg/bin/agent-browser-darwin-arm64")).toBe(
      "#!/bin/sh\nexec '/pkg/bin/agent-browser-darwin-arm64' \"$@\"\n"
    );
  });

  it("names the binary the pinned package ships for this machine", () => {
    expect(nativeBinary("darwin", "arm64")).toBe(
      path.join(agentBrowserRoot, "bin/agent-browser-darwin-arm64")
    );
    expect(nativeBinary("linux", "x64")).toBe(
      path.join(agentBrowserRoot, "bin/agent-browser-linux-x64")
    );
    expect(existsSync(nativeBinary())).toBe(true);
  });

  it("is pinned to an exact version", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "../package.json"), "utf8")
    ) as { devDependencies: Record<string, string> };
    expect(manifest.devDependencies["agent-browser"]).toMatch(
      /^\d+\.\d+\.\d+$/
    );
    expect(agentBrowserVersion()).toBe(
      manifest.devDependencies["agent-browser"]
    );
  });
});

describe("the official skill", () => {
  it("ships in the pinned package under the name the arm allows, with the guides it points to", () => {
    const skill = readFileSync(
      path.join(agentBrowserRoot, "skills/agent-browser/SKILL.md"),
      "utf8"
    );
    expect(skill).toMatch(/^---\nname: agent-browser\n/);
    expect(skill).toContain("agent-browser skills get core");
    expect(
      existsSync(path.join(agentBrowserRoot, "skill-data/core/SKILL.md"))
    ).toBe(true);
    expect(skillDirectory("/run/claude-config")).toBe(
      "/run/claude-config/skills/agent-browser"
    );
  });
});
