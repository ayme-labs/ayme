# MCP source layout

[`eslint.config.js`](eslint.config.js) says what each slice of `src/` holds and which slices and layers each may use. `pnpm lint` refuses a misplaced import, and [`src/layout.test.ts`](src/layout.test.ts) checks that it does. The layers and what each may use are in [`horizontal-boundaries.js`](../eslint-config/horizontal-boundaries.js).

Lint cannot see the rules below:

- Keep every module free of side effects on import, since a slice holds both the server's and the page client's side of its concern, and only tree-shaking keeps one side out of the other's build. [`src/client.test.ts`](src/client.test.ts) checks the built `./client` and `./process` entries.
- Put every file of a layered slice in a layer folder, except its `index.ts`, since lint lets a file outside one use any layer.
- Add behaviour as a file of its own plus one line in a composition root's list, so each root stays the one place that says what it runs:
  - a server tool: a file in `tools/`, listed in [`serverTools.ts`](src/server/serverTools.ts);
  - something the server does with its Agent Connection: [`connectionBehaviours.ts`](src/server/connectionBehaviours.ts);
  - something the page client does while its channel is open: [`clientBehaviours.ts`](src/client/clientBehaviours.ts), or for an App Process, [`processBehaviours.ts`](src/process/processBehaviours.ts);
  - a way the page learns which server to pair with: a file in `pairing/`, listed in [`pairingSources.ts`](src/client/pairingSources.ts).
- Put end-to-end tests in [`apps/mcp-fixture`](../../apps/mcp-fixture/README.md), since they drive the built `ayme` command.
