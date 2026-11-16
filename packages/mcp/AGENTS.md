# MCP source layout

`src/` is cut into slices named for what they do, with layers inside a slice only where it needs them. [`eslint.config.js`](eslint.config.js) is the source of truth for which slices and layers each may use; `pnpm lint` flags a misplaced import, and `src/layout.test.ts` checks that it does.

The package runs in three places: the server (`ayme mcp`) in Node, the page client (`./client`) in the browser, and an App Process's side (`./process`) in a Node process of the app. The slices hold both sides of their concern; each composition root wires only its own side. `src/client.test.ts` checks the built `./client` entry carries no Node built-ins and no server code, and the built `./process` entry no server code, so keep every module free of side effects on import.

Slices, from the bottom up:

- `contract`: the messages between the server and the page client or App Process, as zod schemas both sides validate.
- `pairing`: the connect link, the token, the server's port range and its scan, the tab's stored pairing, the ways the page learns a pairing, and the version gap for which the server refuses a page (`versionGap`).
- `connection`: the server's one paired page, the App Processes beside it and calls to them; the paired page's link for an external Inspector's requests and events; the tRPC channel over WebSocket on both ends, which the server's HTTP server shares with an extension; and the behaviour types the composition roots run.
- `inspector`: the external Inspector (ADR-0049). It serves `@ayme-dev/inspector`'s `./external` build and its WebSocket on the server's own HTTP server (`externalInspectorServer`, passed to the channel server as its extension), relays an Inspector window's requests in order to the paired page over the page channel (`InspectorRelay`, on the connection's `InspectorLink`) and the page's events back, serves the page's contract on the page client side (`serveInspector`, over the `InspectorPort` the runtime hands the client), and holds what `ayme inspect` prints. It reads none of the contract's data but a pick's id, with which the relay cancels the picks of a window that leaves.
- `served-page-objects`: the Page Objects that `ayme mcp` serves (ADR-0051, experimental). It finds the entry (`.ayme/page-objects.ts`, or the `--page-objects` file), builds it with esbuild and `@ayme-dev/ayme/compiler`, the compiler resolved from the entry's folder, serves the build at `/page-objects/` on the server's own HTTP server (`servedPageObjectsServer`, an extension beside the external Inspector's), and writes `.ayme/init-script.js` and its `.gitignore` line. Server side only.
- `tools`: the page's tools as MCP tools, the server's own tools, and the page client's and App Process's work with `ayme.tools`.
- `server`: the composition root of `ayme mcp`. Its index is what `src/cli.ts` starts.
- `client`: the composition root of the `./client` entry.
- `process`: the composition root of the `./process` entry, an App Process's side of the Agent Connection.
- `testing`: the `./testing` entry (ADR-0026), a coding agent's side for e2e tests: it starts the built `ayme` command over stdio with the MCP SDK client and pairs a Playwright page. It uses no slice; nothing uses it.

Layers: `domain` (pure rules and types), `application` (the flows and the ports they use), `infrastructure` (the MCP SDK over stdio, the WebSocket server, tRPC, sessionStorage, the address bar). `contract`, `server`, `client`, `process` and `testing` aren't layered.

- Every file of a layered slice sits in a layer folder, except its `index.ts`.
- Another slice is reached through its `index.ts`.
- `server`, `client` and `process` never use each other.

To add behaviour, add a file and one line in a composition root's list:

- A server tool: a `ServerToolFactory` in `tools/`, listed in `server/serverTools.ts` (`ayme_inspect` is one).
- Something the server does with its Agent Connection: a `ConnectionBehaviour`, listed in `server/connectionBehaviours.ts`.
- Something the page client does while its channel is open: a `ClientBehaviour`, listed in `client/clientBehaviours.ts`; for an App Process, in `process/processBehaviours.ts`.
- A way the page learns which server to pair with: a `PairingSource` in `pairing/`, listed in `client/pairingSources.ts`.

The end-to-end tests live in [`apps/mcp-fixture`](../../apps/mcp-fixture/README.md).
