# Changelog

## [0.3.3](https://github.com/ayme-labs/ayme/compare/angular-v0.3.2...angular-v0.3.3) (2026-11-28)


### Miscellaneous Chores

* **angular:** Synchronize ayme versions

## [0.3.2](https://github.com/ayme-labs/ayme/compare/angular-v0.3.1...angular-v0.3.2) (2026-11-27)


### Miscellaneous Chores

* **angular:** Synchronize ayme versions

## [0.3.1](https://github.com/ayme-labs/ayme/compare/angular-v0.3.0...angular-v0.3.1) (2026-11-27)


### Miscellaneous Chores

* **angular:** Synchronize ayme versions

## [0.3.0](https://github.com/ayme-labs/ayme/compare/angular-v0.2.0...angular-v0.3.0) (2026-11-26)


### ⚠ BREAKING CHANGES

* a rooted Page Object Tool is called with the Page Object's id instead of the Structural Ref of its root. Before: ayme.tools.run("ListItem.archive", { ref: "e9", args }). After: ayme.tools.run("ListItem.archive", { id: "po3", args }). The screenshot Browser Tool is removed: ayme.tools.run("screenshot", ...) no longer runs.

### Features

* ayme adds Page Object Tools to the browser automation a developer already uses ([#1265](https://github.com/ayme-labs/ayme/issues/1265)) ([6b72ab4](https://github.com/ayme-labs/ayme/commit/6b72ab4ab5ed7cd2846807edfef3bafcc672e6ca))
* **ayme:** one in-page module per document ([#1169](https://github.com/ayme-labs/ayme/issues/1169)) ([3b742de](https://github.com/ayme-labs/ayme/commit/3b742dec64148b2e47d067a9f9d2396671c9ee0b))

## [0.2.0](https://github.com/ayme-labs/ayme/compare/angular-v0.1.1...angular-v0.2.0) (2026-11-04)


### Bug Fixes

* **angular:** pin @ayme-dev/angular exactly in ng add ([#1106](https://github.com/ayme-labs/ayme/issues/1106)) ([1f21398](https://github.com/ayme-labs/ayme/commit/1f21398eb5a7012ad7e64d2f2b6fcced37e47405))

## [0.1.1](https://github.com/ayme-labs/ayme/compare/angular-v0.1.0...angular-v0.1.1) (2026-10-30)


### Miscellaneous Chores

* request 0.1.1 to validate trusted publishing ([#1096](https://github.com/ayme-labs/ayme/issues/1096)) ([947f554](https://github.com/ayme-labs/ayme/commit/947f554464c7f0a3c1473f79991af3a830b5cc61))
* request 0.1.1 to validate trusted publishing ([#1096](https://github.com/ayme-labs/ayme/issues/1096)) ([32b57f3](https://github.com/ayme-labs/ayme/commit/32b57f31a929c00644cdb3677f2f55a283a54692))

## 0.1.0 (2026-10-30)


### Miscellaneous Chores

* **angular:** Synchronize ayme versions
