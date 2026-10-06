# @ayme-dev/svelte

The Svelte package for [Ayme](https://github.com/ayme-labs/ayme): it starts Ayme in the root component of your Svelte or SvelteKit app and gives components their Page Objects.

## Install

```sh
npm install @ayme-dev/ayme @ayme-dev/svelte
npm install -D @ayme-dev/unplugin-ayme @playwright/test
```

Add `ayme()` from `@ayme-dev/unplugin-ayme/vite` to your Vite plugins, after `sveltekit()` or `svelte()`, and enable `experimentalDecorators` in your tsconfig.

## Setup

Start Ayme in the root `+layout.svelte`, or `App.svelte` without SvelteKit:

```svelte
<script lang="ts">
  import { useAyme } from "@ayme-dev/svelte";

  useAyme({ webMCP: { enabled: true } });
</script>

<slot />
```

## Peek at component state

While a coding agent or the Inspector is connected, `peek(read, name, id?)` lets the agent read a component's state through the Peek Tool `peek.<name>`:

```svelte
<script lang="ts">
  import { peek } from "@ayme-dev/svelte";

  let count = $state(0);
  peek(() => ({ count }), "counter");
</script>

<button onclick={() => (count += 1)}>{count}</button>
```

Call it during component initialisation, beneath a `useAyme` owner. It takes a getter, because the component's script runs once: the agent reads what `read` returns when it asks. Each mounted component is one instance of the Peek, under the `id` you pass or one of its own. The instance is added in `onMount`, so server rendering adds none, and it is removed when the component is destroyed. `peek` calls [`ayme.peek`](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#aymepeek), so it does nothing unless the owner has `agentConnection` or `inspector` on.

## Documentation

- [Quickstart: Svelte](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/quickstart-svelte.md): from an empty app to your first Page Object Tool.
- [Svelte page](https://github.com/ayme-labs/ayme/blob/main/docs/guide/frameworks/svelte.md): SvelteKit and plain Svelte setup, root ownership, composables, server rendering, limits and API.
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

Svelte 3.54 and later, 4 and 5; SvelteKit 2; Vite 7 and 8.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE)
