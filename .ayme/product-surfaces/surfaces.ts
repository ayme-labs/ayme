import type { Consumers, Surfaces } from "./types";

export const consumers = {
  appDeveloper: {
    name: "App developer",
    who: "A developer on a team that integrates ayme into its own web app.",
    goal: "Turn the app's Page Object Models into tools that agents and the app's own code can call, and see what those agents see.",
    sources: ["docs/guide/start/install.md", "ARCHITECTURE.md"],
  },
  codingAgent: {
    name: "Coding agent",
    who: "Claude Code, Codex, Cursor or another MCP client that the developer runs.",
    goal: "Drive and read the developer's running app, and set ayme up in the project when the developer asks.",
    sources: [
      "docs/guide/guides/connect-an-agent.md",
      "docs/guide/guides/coding-agent-skill.md",
    ],
  },
  inPageAgent: {
    name: "In-page agent",
    who: "An agent that works in the app's page, such as the browser's own agent or an assistant the app ships.",
    goal: "Call the page's tools to act on the page for the person using the app.",
    sources: [
      "docs/guide/guides/publish-tools.md",
      "docs/guide/guides/in-app-assistant.md",
    ],
  },
  evaluator: {
    name: "Evaluating developer",
    who: "A developer who tries ayme before deciding to integrate it.",
    goal: "See what ayme does and whether it fits their app.",
    sources: ["apps/example-vue/README.md", "README.md"],
  },
} satisfies Consumers;

export const surfaces = {
  packagesApi: {
    name: "ayme packages API",
    what: "The TypeScript API of the published runtime packages: @ayme-dev/ayme with its entries, the Vue, React, Svelte and Angular packages, @ayme-dev/webmcp, @ayme-dev/inspector and the client entries of @ayme-dev/mcp, with the errors they throw.",
    consumers: {
      appDeveloper:
        "Marks Page Object Models and actions, starts ayme in the app, registers Custom Tools and Peeks, and calls ayme.tools from the app's code",
      codingAgent:
        "Writes this integration code when it sets ayme up for the developer",
      inPageAgent:
        "Gets the tool list and the tool results from ayme.tools, when it is an assistant the app ships",
    },
    sources: [
      "docs/guide/reference/ayme.md",
      "docs/guide/reference/errors.md",
      "docs/guide/frameworks",
      "packages/ayme/src/index.ts",
      "packages/vue/src/index.ts",
      "packages/react/src/index.ts",
      "packages/svelte/src/index.ts",
      "packages/angular/src/index.ts",
    ],
  },
  buildPlugin: {
    name: "Build plugin",
    what: "The @ayme-dev/unplugin-ayme options a developer sets in the Vite, Angular CLI or Turbopack config.",
    consumers: {
      appDeveloper:
        "Adds the plugin to the bundler config and sets which builds include ayme",
      codingAgent: "Adds and configures the plugin during setup",
    },
    sources: [
      "docs/guide/reference/build-plugin.md",
      "packages/unplugin-ayme/src",
    ],
  },
  angularNgAdd: {
    name: "ng add setup",
    what: "The ng add schematic of @ayme-dev/angular, which sets ayme up in an Angular app.",
    consumers: {
      appDeveloper: "Runs ng add @ayme-dev/angular and answers its options",
      codingAgent: "Runs ng add during setup of an Angular app",
    },
    sources: [
      "docs/guide/start/quickstart-angular.md",
      "packages/angular/schematics",
      "packages/angular/src/schematics/ng-add.ts",
    ],
  },
  aymeCommand: {
    name: "ayme command",
    what: "The ayme command line of @ayme-dev/mcp, ayme mcp and ayme inspect, with its options, its usage text and the init script it writes into the project.",
    consumers: {
      appDeveloper:
        "Registers ayme mcp in the coding agent and runs ayme inspect to open the Inspector",
      codingAgent:
        "Starts ayme mcp as its MCP server, and points a browser tool at the init script it writes",
    },
    sources: [
      "packages/mcp/src/server/readCommand.ts",
      "packages/mcp/src/served-page-objects/infrastructure/initScriptFiles.ts",
      "packages/mcp/README.md",
    ],
  },
  mcpServer: {
    name: "ayme MCP server",
    what: "The MCP tools ayme mcp offers over stdio: ayme_connect, ayme_list_tools, ayme_call and ayme_inspect, and the paired page's Page Object, Browser, Custom, Peek and goal tools.",
    consumers: {
      codingAgent:
        "Connects to a tab, lists and calls the page's tools, reads results and change notes, and hands goals to the Goal Loop",
    },
    sources: [
      "docs/guide/guides/connect-an-agent.md",
      "docs/guide/reference/browser-tools.md",
      "packages/mcp/src/server/serverTools.ts",
      "packages/mcp/src/tools/infrastructure/mcpToolServer.ts",
    ],
  },
  webMcp: {
    name: "WebMCP tools",
    what: "The tools ayme registers on the page's document.modelContext, which Chrome's WebMCP flag or a polyfill the app loads provides.",
    consumers: {
      inPageAgent:
        "Finds the page's Page Object, Browser and Custom Tools and calls them",
      appDeveloper:
        "Turns publication on and loads the WebMCP flag or polyfill",
    },
    sources: [
      "docs/guide/guides/publish-tools.md",
      "packages/webmcp/src/publication.ts",
      "https://developer.chrome.com/docs/ai/webmcp",
    ],
  },
  inspector: {
    name: "Inspector",
    what: "The panel that shows a page's Page Objects, page state and tools and runs them by hand, in the page, in a window of its own or inside an agent app's chat.",
    consumers: {
      appDeveloper:
        "Opens the panel, browses its lenses and runs tools by hand",
      evaluator: "Tries the tools in the panel's demo mode on the playground",
    },
    sources: [
      "docs/guide/guides/inspector.md",
      "packages/inspector/src",
      "packages/mcp/src/inspector/infrastructure/externalInspectorServer.ts",
    ],
  },
  decisionEndpoint: {
    name: "Decision Endpoint",
    what: "The HTTP contract of the route in the app's backend that the Goal Loop calls for each decision, and that adds the provider key.",
    consumers: {
      appDeveloper:
        "Mounts the handler from @ayme-dev/ayme/server on a route, gates it, and gives it a key",
    },
    sources: [
      "docs/guide/reference/decision-endpoint.md",
      "packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts",
    ],
  },
  decisionProvider: {
    name: "Decision model provider",
    what: "TypeSafe or OpenRouter, where the developer gets the key the Decision Endpoint sends with each Goal Loop decision to Jev.",
    consumers: {
      appDeveloper:
        "Gets an API key and picks the provider for the Decision Endpoint",
    },
    sources: [
      "docs/guide/guides/goals-with-jev.md",
      "https://typesafe.ai",
      "https://openrouter.ai",
    ],
  },
  agentMcpSettings: {
    name: "Coding agent MCP settings",
    what: "The MCP server settings of Claude Code, Codex, Cursor or another MCP client, where the developer registers ayme mcp.",
    consumers: {
      appDeveloper:
        "Registers ayme mcp at the pinned version, then restarts the agent",
    },
    sources: ["docs/guide/guides/connect-an-agent.md"],
  },
  browserToolConfig: {
    name: "Playwright MCP and Playwright CLI",
    what: "The browser tools whose config loads the init script, so ayme mcp can serve Page Objects to a page that does not ship ayme.",
    consumers: {
      appDeveloper:
        "Points the browser tool's config at .ayme/init-script.js and allows the local connection",
      codingAgent: "Opens the page in the browser tool and connects ayme to it",
    },
    sources: [
      "docs/guide/guides/page-objects-without-ayme.md",
      "https://github.com/microsoft/playwright-mcp",
    ],
  },
  skills: {
    name: "Coding agent skills",
    what: "The skills ayme ships for coding agents, ayme, ayme-recorder and product-surfaces, with the .ayme/CONVENTIONS.md file they read and write.",
    consumers: {
      codingAgent:
        "Follows a skill to set ayme up, use the page's tools, record a flow or list product surfaces",
      appDeveloper:
        "Installs the skills, and settles answers that the skills keep in .ayme/CONVENTIONS.md",
    },
    sources: [
      "docs/guide/guides/coding-agent-skill.md",
      "skills/ayme",
      "skills/ayme-recorder",
      "skills/product-surfaces",
    ],
  },
  skillsCli: {
    name: "skills CLI",
    what: "The skills command line from Vercel Labs, which installs ayme's skills from this repository into a project.",
    consumers: {
      appDeveloper:
        "Runs npx skills add ayme-labs/ayme --skill <name> and picks the skills",
    },
    sources: [
      "docs/guide/guides/coding-agent-skill.md",
      "https://github.com/vercel-labs/skills",
    ],
  },
  recorderCommand: {
    name: "Recorder command",
    what: "The command line of @ayme-dev/cli: codegen, which opens the recorder, and the trace commands.",
    consumers: {
      codingAgent:
        "Runs codegen for the user, waits for the Recording Package path, and runs trace commands to look at a recorded step",
      appDeveloper: "Runs codegen to record a flow",
    },
    sources: [
      "skills/ayme-recorder/SKILL.md",
      "https://www.npmjs.com/package/@ayme-dev/cli",
    ],
  },
  recorderWindow: {
    name: "Recorder window",
    what: "The browser window the recorder opens, with its controls and timeline, where the user drives the flow and presses Finish.",
    consumers: {
      appDeveloper:
        "Drives the flow, discards or restores entries in the timeline, and finishes the recording",
    },
    sources: ["docs/cli/images", "https://www.npmjs.com/package/@ayme-dev/cli"],
  },
  recordingPackage: {
    name: "Recording Package",
    what: "The files the recorder writes for one recording: the page structure at each visit, what changed and every interaction.",
    consumers: {
      codingAgent:
        "Reads the package and turns it into page objects and a test, or an automation of the flow",
    },
    sources: [
      "skills/ayme-recorder/SKILL.md",
      "https://www.npmjs.com/package/@ayme-dev/cli",
    ],
  },
  docs: {
    name: "Documentation",
    what: "The guide in docs/guide, published at ayme-labs.github.io/ayme/docs and read on GitHub, with the root README and the package READMEs on npm.",
    consumers: {
      appDeveloper:
        "Reads the install steps, quickstarts, guides, reference and troubleshooting",
      evaluator: "Reads what ayme is and how it compares with Playwright",
      codingAgent:
        "Follows the guide pages that the skills link to during setup",
    },
    sources: [
      "docs/guide",
      "README.md",
      "packages/ayme/README.md",
      "https://ayme-labs.github.io/ayme/docs/",
    ],
  },
  releaseNotes: {
    name: "Release notes",
    what: "The changelog of each published package and its GitHub release.",
    consumers: {
      appDeveloper: "Reads what changed before upgrading the ayme packages",
    },
    sources: [
      "packages/ayme/CHANGELOG.md",
      "release-please-config.json",
      "docs/releasing.md",
    ],
  },
  playground: {
    name: "Playground",
    what: "The hosted demo list app with the Inspector in demo mode, at ayme-labs.github.io/ayme and ayme.dev/playground.",
    consumers: {
      evaluator: "Edits the list and runs the page's tools from the Inspector",
    },
    sources: [
      "apps/example-vue",
      ".github/workflows/deploy-example-vue.yml",
      "https://ayme-labs.github.io/ayme/",
    ],
  },
  website: {
    name: "ayme.dev website",
    what: "The ayme website at ayme.dev, which proxies the playground under /playground.",
    consumers: {
      evaluator: "Reads what ayme is and opens the playground",
    },
    sources: [".github/workflows/deploy-example-vue.yml", "https://ayme.dev"],
  },
} satisfies Surfaces<keyof typeof consumers>;
