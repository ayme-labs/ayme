# React integration smoke app

A counter with one compiled Page Object, running beneath `AymeWebMcpProvider` in React Strict Mode. It checks the integration without duplicating the Vue inspector demo.

From the workspace root:

```sh
pnpm run build
pnpm --filter @ayme-dev/example-react dev
pnpm --filter @ayme-dev/example-react test:e2e
```

The app works without a WebMCP driver through the direct Page Object button. End-to-end tests install a recording driver, execute a generated tool, and check tool removal and restoration as the counter unmounts and mounts. Another test uses the same POM through real Playwright.

See the [React package README](../../packages/webmcp-react/README.md) for setup and lifecycle rules. SSR and Next.js remain follow-up work.

## Throwaway peek prototype

Run `pnpm prototype:peek` from the workspace root, then open
<http://127.0.0.1:4191/?peek>. This route runs under React Strict Mode.

Increment A and B independently, then request a snapshot. Repeat reads should keep
both identities. Unmount B and snapshot again; remount it and check its new identity
and zero count. Stop/start the provider to exercise runtime teardown.

The temporary `usePeek(() => ({ count }), label)` hook tests getter ownership and
latest committed state. It requires normal hook order. Values are synchronous and
JSON-friendly. Labels only help distinguish the demo counters. Source labels,
`ayme.peek({ count })` transformation, stores, log events and
production error/serialization policies are deferred. Nothing persists.

The standalone `peek` MCP tool is available in this prototype document, including
the inspector's Tools tab. Run `peek({})` to discover `{ peeks: [{ id, label }] }`
without invoking getters. Run `peek({ id: "<live-id>" })` to read one instance as
`{ id, label, value }`. Unknown or unmounted IDs return the normal MCP `isError`
result. Compare the `evaluations` field to see that selected reads invoke only
their selected counter. `get_page_context` still reads every live getter.

Open `/?peek&empty` to start the provider with no peeks. Press "Mount first peeks"
to check that `peek` appears in MCP and the inspector without a reload or retry.
