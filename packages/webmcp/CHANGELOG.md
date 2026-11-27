# Changelog

## [0.3.2](https://github.com/ayme-labs/ayme/compare/webmcp-v0.3.1...webmcp-v0.3.2) (2026-11-27)


### Miscellaneous Chores

* **webmcp:** Synchronize ayme versions

## [0.3.1](https://github.com/ayme-labs/ayme/compare/webmcp-v0.3.0...webmcp-v0.3.1) (2026-11-27)


### Miscellaneous Chores

* **webmcp:** Synchronize ayme versions

## [0.3.0](https://github.com/ayme-labs/ayme/compare/webmcp-v0.2.0...webmcp-v0.3.0) (2026-11-26)


### ⚠ BREAKING CHANGES

* a rooted Page Object Tool is called with the Page Object's id instead of the Structural Ref of its root. Before: ayme.tools.run("ListItem.archive", { ref: "e9", args }). After: ayme.tools.run("ListItem.archive", { id: "po3", args }). The screenshot Browser Tool is removed: ayme.tools.run("screenshot", ...) no longer runs.

### Features

* ayme adds Page Object Tools to the browser automation a developer already uses ([#1265](https://github.com/ayme-labs/ayme/issues/1265)) ([6b72ab4](https://github.com/ayme-labs/ayme/commit/6b72ab4ab5ed7cd2846807edfef3bafcc672e6ca))
* mark irreversible actions destructive for agents ([#1321](https://github.com/ayme-labs/ayme/issues/1321)) ([6a6b7d3](https://github.com/ayme-labs/ayme/commit/6a6b7d3971cceb1d8481a313765b8d62101a4bbe))

## [0.2.0](https://github.com/ayme-labs/ayme/compare/webmcp-v0.1.1...webmcp-v0.2.0) (2026-11-04)


### Bug Fixes

* **webmcp:** depend on upstream webmcp-types ([#1107](https://github.com/ayme-labs/ayme/issues/1107)) ([07d0026](https://github.com/ayme-labs/ayme/commit/07d00266d5ac224b9fe1ac604aca3485c6e9950a)), closes [#1103](https://github.com/ayme-labs/ayme/issues/1103)

## [0.1.1](https://github.com/ayme-labs/ayme/compare/webmcp-v0.1.0...webmcp-v0.1.1) (2026-10-30)


### Miscellaneous Chores

* request 0.1.1 to validate trusted publishing ([#1096](https://github.com/ayme-labs/ayme/issues/1096)) ([947f554](https://github.com/ayme-labs/ayme/commit/947f554464c7f0a3c1473f79991af3a830b5cc61))
* request 0.1.1 to validate trusted publishing ([#1096](https://github.com/ayme-labs/ayme/issues/1096)) ([32b57f3](https://github.com/ayme-labs/ayme/commit/32b57f31a929c00644cdb3677f2f55a283a54692))

## 0.1.0 (2026-10-30)


### Miscellaneous Chores

* **webmcp:** Synchronize ayme versions
