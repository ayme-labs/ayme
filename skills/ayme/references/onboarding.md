# Onboarding

1. Inspect the project's package manager, bundler, framework, and existing POMs.
2. Read the [main library README](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md)
   for installation and explicit action exposure. Reuse an existing action.
3. Read the [compiler README](https://github.com/ayme-labs/ayme/blob/main/packages/unplugin-ayme/README.md)
   for build setup. For Vue lifecycle wiring, read the
   [Vue README](https://github.com/ayme-labs/ayme/blob/main/packages/vue/README.md).
   For Svelte or SvelteKit wiring, read the
   [Svelte README](https://github.com/ayme-labs/ayme/blob/main/packages/svelte/README.md).
   Other framework integrations are not documented yet; report that gap rather
   than adapting internal runtime APIs into an unsupported setup.
4. Follow [Browser setup](browser-setup.md) to choose native WebMCP or a local
   polyfill and relay, then invoke the exposed action through the client.

The packages are not published yet. If registry installation is unavailable,
use supplied package tarballs or report the missing release. Keep all Ayme
packages on a matching version. A supplied repository checkout can provide the
README files above locally; when installing the skill elsewhere, retain the
references directory and these upstream README links.

Finish by reporting the packages and wiring changed, the action invoked, and
its observed effect. If browser or client access is unavailable, distinguish
successful build checks from the invocation still outstanding.
