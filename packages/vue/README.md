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

## Documentation

- [Quickstart: Vue](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/quickstart-vue.md): from an empty app to your first Page Object Tool.
- [Vue page](https://github.com/ayme-labs/ayme/blob/main/docs/guide/frameworks/vue.md): the provider and standalone setup, root ownership, hooks, server rendering with Nuxt, limits and API.
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

Vue 3.2.0 and later, Nuxt 4.0.1 and later, Vite 7 and 8.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE)
