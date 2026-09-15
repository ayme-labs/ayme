# Try the playground with an agent

The hosted [Ayme WebMCP playground](https://ayme-labs.github.io/ayme/) exposes the list Page Object as WebMCP Tools. It does not run an agent backend or store a relay connection.

1. Install or enable the repository's [Ayme setup skill](https://github.com/ayme-labs/ayme/tree/main/skills/ayme).
2. Follow its [browser setup guide](https://github.com/ayme-labs/ayme/blob/main/skills/ayme/references/browser-setup.md) to start the local MCP relay.
3. Open the hosted playground, then use the relay client to list sources and tools.
4. Invoke a list action and confirm its visible result in the page.

For a local build, run the commands in the [example README](./README.md) inside the repository's Devbox shell.
