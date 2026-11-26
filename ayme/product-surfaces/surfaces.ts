import type { Consumers, Surfaces } from "./types";

export const consumers = {
  appDeveloper: {
    name: "App developer",
    who: "A developer who adds ayme to their web app",
    goal: "Let agents and the app's own assistant work the app through its page objects, and have their coding agent drive the app while they develop",
    sources: [
      "README.md",
      "docs/guide/start/what-is-ayme.md",
      "docs/guide/start/install.md",
    ],
  },
  appTester: {
    name: "App tester",
    who: "Whoever writes the app's Playwright tests, a developer or a QA engineer",
    goal: "Record a flow and get page objects and a test from it, with no ayme in the app",
    sources: ["packages/cli/README.md", "docs/guide/guides/recorder.md"],
  },
  prospect: {
    name: "Prospect",
    who: "A developer who has not adopted ayme yet",
    goal: "See what ayme does and decide whether it fits their app",
    sources: [
      "README.md",
      "docs/guide/start/what-is-ayme.md",
      "https://ayme.dev/playground/",
    ],
  },
  codingAgent: {
    name: "Coding agent",
    who: "An AI coding assistant such as Claude Code, Codex or Cursor that works in the developer's project",
    goal: "Drive and read the app the developer has open with fewer, surer steps, and set ayme up or turn recordings into tests",
    sources: [
      "docs/guide/guides/connect-an-agent.md",
      "docs/guide/guides/coding-agent-skill.md",
    ],
  },
  browserAgent: {
    name: "In-browser agent",
    who: "An AI agent that runs inside the browser page, such as a browser's own agent or an assistant the developer built into the app",
    goal: "Work the page for its user by calling the tools the page offers, or hand it a goal to reach",
    sources: [
      "docs/guide/guides/publish-tools.md",
      "docs/guide/guides/in-app-assistant.md",
    ],
  },
} satisfies Consumers;

export const surfaces = {
  corePackage: {
    name: "Core package (`@ayme-dev/ayme`)",
    what: "The core package a developer installs into their app, which marks page objects and their actions and starts ayme",
    consumers: {
      appDeveloper:
        "Marks page objects and their actions, starts ayme with the options they want, adds Peeks and Custom Tools, and reads the errors it reports",
      browserAgent:
        "Gets the page's tools and page state when the developer's own assistant is built on this package",
    },
    sources: ["packages/ayme", "docs/guide/reference/ayme.md"],
  },
  vuePackage: {
    name: "Vue package",
    what: "The package that starts ayme in a Vue app and ties page objects to its components",
    consumers: {
      appDeveloper:
        "Starts ayme in their Vue app with the options they want and uses page objects from their components",
      browserAgent:
        "Gets the page's tools and page state when the developer's own assistant is built on this package",
    },
    sources: [
      "packages/vue",
      "docs/guide/frameworks/vue.md",
      "docs/guide/start/quickstart-vue.md",
    ],
  },
  reactPackage: {
    name: "React package",
    what: "The package that starts ayme in a React app and ties page objects to its components",
    consumers: {
      appDeveloper:
        "Starts ayme in their React app with the options they want and uses page objects from their components",
      browserAgent:
        "Gets the page's tools and page state when the developer's own assistant is built on this package",
    },
    sources: [
      "packages/react",
      "docs/guide/frameworks/react.md",
      "docs/guide/start/quickstart-react.md",
    ],
  },
  sveltePackage: {
    name: "Svelte package",
    what: "The package that starts ayme in a Svelte app and ties page objects to its components",
    consumers: {
      appDeveloper:
        "Starts ayme in their Svelte app with the options they want and uses page objects from their components",
      browserAgent:
        "Gets the page's tools and page state when the developer's own assistant is built on this package",
    },
    sources: [
      "packages/svelte",
      "docs/guide/frameworks/svelte.md",
      "docs/guide/start/quickstart-svelte.md",
    ],
  },
  angularPackage: {
    name: "Angular package",
    what: "The package that starts ayme in an Angular app and ties page objects to its components, with a setup command (ng add) that installs and wires ayme in one go",
    consumers: {
      appDeveloper:
        "Runs the setup command once or wires ayme by hand, starts it with the options they want and uses page objects from their components",
      browserAgent:
        "Gets the page's tools and page state when the developer's own assistant is built on this package",
    },
    sources: [
      "packages/angular",
      "packages/angular/schematics",
      "docs/guide/frameworks/angular.md",
      "docs/guide/start/quickstart-angular.md",
    ],
  },
  buildPlugin: {
    name: "Build plugin",
    what: "The plugin added to the app's build that compiles the marked page objects into the app",
    consumers: {
      appDeveloper:
        "Adds it to the build setup and sets its options, such as where Playwright settings come from",
    },
    sources: ["packages/unplugin-ayme", "docs/guide/reference/build-plugin.md"],
  },
  aymeCommand: {
    name: "`ayme` command",
    what: "The terminal command of the package @ayme-dev/mcp: `ayme mcp` starts the server for a coding agent, with options to pick its port and, as an experiment, a page objects file to serve; `ayme inspect` prints the Inspector's address for the running server, with an option to pick its port",
    consumers: {
      appDeveloper:
        "Writes `ayme mcp` into their coding agent's settings and runs `ayme inspect` to get the Inspector's address",
    },
    sources: [
      "packages/mcp/src/cli.ts",
      "packages/mcp/src/server/readCommand.ts",
      "packages/mcp/README.md",
    ],
  },
  mcpServer: {
    name: "MCP server for coding agents",
    what: "The tools the coding agent calls on the running server, which pairs with one tab of the app and its server processes: connect to a tab, list the page's tools, call one, and show the Inspector",
    consumers: {
      appDeveloper: "Opens the connect link or lets the tab pair by itself",
      codingAgent:
        "Connects to the app's tab, lists and calls the page's actions, reads Page Objects and Peeks, and hands the page a goal",
    },
    sources: [
      "packages/mcp/src/tools",
      "packages/mcp/src/connection",
      "packages/mcp/src/pairing",
      "docs/guide/guides/connect-an-agent.md",
      "docs/guide/guides/page-objects-without-ayme.md",
    ],
  },
  webmcpTools: {
    name: "Tools published in the page (WebMCP)",
    what: "The experimental publication of the page's tools through the browser's own way for pages to offer tools to agents",
    consumers: {
      appDeveloper:
        "Turns publication on and checks whether the tools are published",
      browserAgent:
        "Calls the page's actions, the built-in clicking and typing tools and Custom Tools, and hands the page a goal",
    },
    sources: [
      "packages/webmcp",
      "docs/guide/guides/publish-tools.md",
      "docs/guide/reference/browser-tools.md",
    ],
  },
  inspector: {
    name: "Inspector",
    what: "The panel that shows the page's page objects, what an agent sees and every tool, inside the page, in a separate window or in an agent app's chat",
    consumers: {
      appDeveloper:
        "Looks at what the agent sees, runs tools by hand, and shows others what an agent does in demo mode",
      codingAgent:
        "Hands the developer the Inspector's window address or shows it in the chat",
    },
    sources: ["packages/inspector", "docs/guide/guides/inspector.md"],
  },
  decisionEndpoint: {
    name: "Decision Endpoint",
    what: "The experimental route the developer mounts in their backend so the Goal Loop can ask a decision model for each step with the developer's key",
    consumers: {
      appDeveloper:
        "Mounts the route, adds their model key and decides who may use it",
    },
    sources: [
      "docs/guide/reference/decision-endpoint.md",
      "docs/guide/guides/goals-with-jev.md",
    ],
  },
  modelProvider: {
    name: "Decision model provider (TypeSafe or OpenRouter)",
    what: "The outside service that runs the decision model behind the Goal Loop, reached with the developer's own key",
    consumers: {
      appDeveloper:
        "Gets a key from the provider and chooses which provider the Decision Endpoint forwards to",
    },
    sources: [
      "https://api.typesafe.ai/v1/systemone",
      "https://openrouter.ai/api/v1/systemone",
      "docs/guide/reference/decision-endpoint.md",
    ],
  },
  browserAutomation: {
    name: "The agent's own browser automation",
    what: "The outside browser tools a coding agent already uses, such as Playwright MCP, Playwright CLI or agent-browser, which ayme works beside",
    consumers: {
      codingAgent:
        "Opens and drives the app's page with it, while ayme adds the page's own actions",
      appDeveloper:
        "Sets one up for their agent, as ayme brings none of its own for coding agents",
    },
    sources: [
      "https://github.com/microsoft/playwright-mcp",
      "skills/ayme/references/browser-automation-tools.md",
      "docs/guide/guides/page-objects-without-ayme.md",
    ],
  },
  recorderCommand: {
    name: "`ayme capture` command",
    what: "The `ayme` command of @ayme-dev/cli. `ayme capture` opens the app at an address in Chromium for recording, with options to open it without a window, to start already recording, and to load or save a login; with `--cdp=<url>` instead, it records a Chromium that is already running. When Chromium cannot be opened, it names Playwright's own command that installs it. It also prints its help and its version",
    consumers: {
      appTester: "Starts a recording, and loads or saves a login",
      codingAgent:
        "Runs the recording command for the user when the ayme-capture skill tells it to",
    },
    sources: [
      "packages/cli",
      "packages/recorder",
      "docs/guide/guides/recorder.md",
    ],
  },
  recorderWindow: {
    name: "Recorder window and page toolbar",
    what: "The window beside the recorded app, and the small toolbar on the page, where a recording is started, paused, edited and finished",
    consumers: {
      appTester:
        "Records a flow, marks what must be visible, discards wrong steps and finishes the recording",
    },
    sources: ["packages/recorder-window", "packages/cli/README.md"],
  },
  recordingPackage: {
    name: "Recording Package",
    what: "The saved recording files: each page visit, each step and what it changed, plus a browser trace",
    consumers: {
      codingAgent:
        "Reads a recording and turns it into page objects and a test that replays the flow",
      appTester:
        "Finds the latest recording in the project and hands it to the agent",
    },
    sources: ["packages/recorder/src/contract", "skills/ayme-capture/SKILL.md"],
  },
  agentSkills: {
    name: "Coding agent skills",
    what: "The instruction sets ayme ships for coding agents: setting ayme up, turning recordings into tests, and listing a product's users and surfaces",
    consumers: {
      appDeveloper: "Installs the setup skill into their project",
      appTester: "Installs the recorder skill into their project",
      codingAgent:
        "Follows a skill to set ayme up, design page objects, turn a recording into a test, or review changes by what users will notice",
    },
    sources: [
      "skills/ayme",
      "skills/ayme-capture",
      "skills/product-surfaces",
      "docs/guide/guides/coding-agent-skill.md",
    ],
  },
  documentation: {
    name: "Documentation",
    what: "The ayme documentation site and the same pages on GitHub, plus the repository's readme",
    consumers: {
      appDeveloper:
        "Follows the install steps and quickstarts, the guides and the reference, and looks up problems",
      appTester:
        "Reads how to record a flow and turn it into page objects and a test",
      prospect: "Reads what ayme is and what it does",
      codingAgent:
        "Reads the guides and reference while setting ayme up for the developer",
    },
    sources: [
      "docs/guide",
      "README.md",
      "https://ayme-labs.github.io/ayme/docs/",
    ],
  },
  releasedPackages: {
    name: "Released packages",
    what: "The ayme packages as published on npm, including @ayme-dev/mcp and @ayme-dev/cli: each one's name, version, readme and what installing it needs, and each version's release notes",
    consumers: {
      appDeveloper:
        "Installs and updates the packages for their app and the `ayme` command, and reads their readmes and release notes",
      appTester:
        "Installs and updates @ayme-dev/cli, and reads its readme and release notes",
      codingAgent:
        "Installs the right packages and versions while setting ayme up or recording, and reads their readmes",
    },
    sources: [
      "release-please-config.json",
      ".release-please-manifest.json",
      ".github/workflows/release.yml",
      "scripts/publish-packages.mjs",
      "packages/ayme/README.md",
      "packages/vue/README.md",
      "packages/react/README.md",
      "packages/svelte/README.md",
      "packages/angular/README.md",
      "packages/unplugin-ayme/README.md",
      "packages/inspector/README.md",
      "packages/webmcp/README.md",
      "packages/mcp/README.md",
      "packages/cli/README.md",
    ],
  },
  playground: {
    name: "Playground",
    what: "The Vue example app, deployed publicly from the main branch, with the Inspector in demo mode",
    consumers: {
      prospect:
        "Tries the example app and watches in the Inspector what an agent sees and does",
    },
    sources: [
      "apps/example-vue",
      ".github/workflows/deploy-example-vue.yml",
      "https://ayme.dev/playground/",
    ],
  },
} satisfies Surfaces<keyof typeof consumers>;
