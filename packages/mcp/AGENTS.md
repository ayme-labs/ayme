# MCP source layout

`src/` is cut into slices named for what they do, with layers inside a slice only where it needs them. [`eslint.config.js`](eslint.config.js) is the source of truth for which slices and layers each may use; `pnpm lint` flags a misplaced import, and `src/layout.test.ts` checks that it does.

The package runs in two places: the server (`ayme mcp`) in Node and the page client (`./client`) in the browser. The slices hold both sides of their concern; each composition root wires only its own side. `src/client.test.ts` checks the built `./client` entry carries no Node built-ins and no server code, so keep every module free of side effects on import.

Slices, from the bottom up:

- `contract`: the messages between server and page client, as zod schemas both sides validate.
- `pairing`: the connect link, the token, the server's port range, the tab's stored pairing and the ways the page learns a pairing.
- `connection`: the server's one paired page and calls to it, the tRPC channel over WebSocket on both ends, and the behaviour types both composition roots run.
- `tools`: the page's tools as MCP tools, the server's own tools, and the page client's work with `ayme.tools`.
- `server`: the composition root of `ayme mcp`. Its index is what `src/cli.ts` starts.
- `client`: the composition root of the `./client` entry.
- `testing`: the `./testing` entry (ADR-0026), a coding agent's side for e2e tests: it starts the built `ayme` command over stdio with the MCP SDK client and pairs a Playwright page. It uses no slice; nothing uses it.

Layers: `domain` (pure rules and types), `application` (the flows and the ports they use), `infrastructure` (the MCP SDK over stdio, the WebSocket server, tRPC, sessionStorage, the address bar). `contract`, `server`, `client` and `testing` aren't layered.

- Every file of a layered slice sits in a layer folder, except its `index.ts`.
- Another slice is reached through its `index.ts`.
- `server` and `client` never use each other.

To add behaviour, add a file and one line in a composition root's list:

- A server tool: a `ServerToolFactory` in `tools/`, listed in `server/serverTools.ts`.
- Something the server does with its Agent Connection: a `ConnectionBehaviour`, listed in `server/connectionBehaviours.ts`.
- Something the page client does while its channel is open: a `ClientBehaviour`, listed in `client/clientBehaviours.ts`.
- A way the page learns which server to pair with: a `PairingSource` in `pairing/`, listed in `client/pairingSources.ts`.

The end-to-end tests live in [`apps/mcp-fixture`](../../apps/mcp-fixture/README.md).
