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

## Peek at component state

While a coding agent or the Inspector is connected, `usePeek(values, name, id?)` lets the agent read a component's state through the Peek Tool `peek.<name>`:

```tsx
import { useState } from "react";
import { usePeek } from "@ayme-dev/react";

function Counter() {
  const [count, setCount] = useState(0);
  usePeek({ count }, "counter");
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

Each mounted component is one instance of the Peek, under the `id` you pass or one from `useId`. The agent reads `values` from the component's latest committed render. The instance is added after mount, so server rendering adds none, and it is removed on unmount; a StrictMode remount keeps the tool. `usePeek` calls [`ayme.peek`](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#aymepeek), so it does nothing unless the provider has `agentConnection` or `inspector` on.

## Documentation

- [Quickstart: React](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/quickstart-react.md): from an empty app to your first Page Object Tool.
- [React page](https://github.com/ayme-labs/ayme/blob/main/docs/guide/frameworks/react.md): the provider, root ownership, hooks, server rendering with Next.js, limits and API.
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

React 18 and 19, Next.js 16.0 and later, Vite 7 and 8.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE)
