# @ayme-dev/react

The React package for [Ayme](https://github.com/ayme-labs/ayme): it starts Ayme at the root of your React app and gives components their Page Objects.

## Install

```sh
npm install @ayme-dev/ayme @ayme-dev/react
npm install -D @ayme-dev/unplugin-ayme @playwright/test
```

Add `ayme()` from `@ayme-dev/unplugin-ayme/vite` to your Vite plugins, beside `react()`. On Next.js, use the build plugin's Turbopack loader.

## Setup

Wrap the app in `AymeProvider`:

```tsx
import { createRoot } from "react-dom/client";
import { AymeProvider } from "@ayme-dev/react";

createRoot(document.getElementById("root")!).render(
  <AymeProvider webMCP={{ enabled: true }}>
    <App />
  </AymeProvider>
);
```

## Documentation

- [Quickstart: React](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/quickstart-react.md): from an empty app to your first Page Object Tool.
- [React page](https://github.com/ayme-labs/ayme/blob/main/docs/guide/frameworks/react.md): the provider, root ownership, hooks, server rendering with Next.js, limits and API.
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

React 18 and 19, Next.js 16.0 and later, Vite 7 and 8.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE)
