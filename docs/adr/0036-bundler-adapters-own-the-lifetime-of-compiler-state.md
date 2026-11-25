---
status: accepted
---

# Bundler adapters own the lifetime of compiler state

Building a TypeScript Program for each Page Object Model module made up most of an example app's build, while every module of one tsconfig project gets a Program over the same files. The compiler therefore keeps one Program per project, and the bundler adapter owns how long it lives: it tells the compiler when a build starts and ends and, in a dev server, which files changed. The compiler never watches the file system itself, and where a bundler gives no such signals, it keeps no state. We rejected TypeScript's watch API, which installs its own file watchers and debounce beside the bundler's, and a process-wide cache shared by every plugin instance, which nothing would ever clear. This extends ADR-0006: compiler derivation stays separate from bundler transport, and the adapter alone knows when inputs may have changed.
