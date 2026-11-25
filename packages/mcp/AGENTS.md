# MCP source layout

[`eslint.config.js`](eslint.config.js) says what each slice of `src/` holds and which slices and layers each may use. `pnpm lint` refuses any import, `import("…")` types included, that breaks them, and [`src/layout.test.ts`](src/layout.test.ts) checks that it does, and that every file of a layered slice but its `index.ts` sits in a layer folder. The layers and what each may use are in [`horizontal-boundaries.js`](../eslint-config/horizontal-boundaries.js). [`testing-entries.js`](../eslint-config/testing-entries.js) keeps production code from importing the test support in [`testing/`](testing/index.ts).

Lint cannot see the rules below:

- Have each composition root (`server`, `client`, `process`) wire only its own side's behaviour, since lint stops one root importing another but not one wiring the other's code.
- Keep `src/` out of `testing/` in a dynamic import or `import("…")` type too, since test support drives the built command from outside; lint checks only static imports there.
- Give `import()` a plain string, unless the path is known only at run time, since lint reads only that string.
- Keep every module free of side effects on import, since a slice holds both the server's and the page client's side of its concern, and only tree-shaking keeps one side out of the other's build. [`src/client.test.ts`](src/client.test.ts) checks the built `./client` and `./process` entries.
- Add behaviour as a file of its own plus one line in a composition root's list, so each root stays the one place that says what it runs:
  - a server tool: a file in `tools/`, listed in [`serverTools.ts`](src/server/serverTools.ts);
  - something the server does with its Agent Connection: [`connectionBehaviours.ts`](src/server/connectionBehaviours.ts);
  - something the page client does while its channel is open: [`clientBehaviours.ts`](src/client/clientBehaviours.ts), or for an App Process, [`processBehaviours.ts`](src/process/processBehaviours.ts);
  - a way the page learns which server to pair with: a file in `pairing/`, listed in [`pairingSources.ts`](src/client/pairingSources.ts).
- Put end-to-end tests in [`apps/mcp-fixture`](../../apps/mcp-fixture/README.md), since they drive the built `ayme` command.
