# @ayme-dev/vue

The Vue package for [Ayme](https://github.com/ayme-labs/ayme): it starts Ayme at the root of your Vue app and gives components their Page Objects.

## Install

```sh
npm install @ayme-dev/ayme @ayme-dev/vue
npm install -D @ayme-dev/unplugin-ayme @playwright/test
```

Add `ayme()` from `@ayme-dev/unplugin-ayme/vite` to your Vite plugins, after `vue()`.

## Setup

Wrap the app in `AymeProvider`:

```vue
<script setup lang="ts">
import { AymeProvider } from "@ayme-dev/vue";
import App from "./App.vue";
</script>

<template>
  <AymeProvider :webMCP="{ enabled: true }"><App /></AymeProvider>
</template>
```

## Peek at component state

While a coding agent or the Inspector is connected, `usePeek(values, name, id?)` lets the agent read a component's state through the Peek Tool `peek.<name>`:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { usePeek } from "@ayme-dev/vue";

const count = ref(0);
usePeek({ count }, "counter");
</script>

<template>
  <button @click="count += 1">{{ count }}</button>
</template>
```

`values` may be a ref, a reactive object or an object of refs; the agent reads their current values when it calls the tool. Each mounted component is one instance of the Peek, under the `id` you pass or one from the component instance. The instance is added in `onMounted`, so server rendering adds none, and it is removed on unmount. `usePeek` calls [`ayme.peek`](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#aymepeek), so it does nothing unless the owner has `agentConnection` or `inspector` on.

## Documentation

- [Quickstart: Vue](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/quickstart-vue.md): from an empty app to your first Page Object Tool.
- [Vue page](https://github.com/ayme-labs/ayme/blob/main/docs/guide/frameworks/vue.md): the provider and standalone setup, root ownership, hooks, server rendering with Nuxt, limits and API.
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

Vue 3.2.0 and later, Nuxt 4.0.1 and later, Vite 7 and 8.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE)
