# React integration smoke app

A counter with one compiled Page Object, running beneath `AymeProvider` in React Strict Mode. It checks the integration without duplicating the Vue inspector demo.

From the workspace root:

```sh
pnpm run build
pnpm --filter @ayme-dev/example-react dev
pnpm --filter @ayme-dev/example-react test:e2e
```

The app works without a WebMCP driver through the direct Page Object button. End-to-end tests install a recording driver, execute a Page Object Tool, and check tool removal and restoration as the counter unmounts and mounts. Another test uses the same POM through real Playwright, and a smoke test opens the Inspector, which the app turns on unless built with `--mode inspector-disabled`, and runs a tool from it.

See the [React package README](../../packages/react/README.md) for setup and lifecycle rules.
