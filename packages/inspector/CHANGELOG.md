# Changelog

## [0.3.0](https://github.com/ayme-labs/ayme/compare/inspector-v0.2.0...inspector-v0.3.0) (2026-11-26)


### ⚠ BREAKING CHANGES

* a rooted Page Object Tool is called with the Page Object's id instead of the Structural Ref of its root. Before: ayme.tools.run("ListItem.archive", { ref: "e9", args }). After: ayme.tools.run("ListItem.archive", { id: "po3", args }). The screenshot Browser Tool is removed: ayme.tools.run("screenshot", ...) no longer runs.

### Features

* ayme adds Page Object Tools to the browser automation a developer already uses ([#1265](https://github.com/ayme-labs/ayme/issues/1265)) ([6b72ab4](https://github.com/ayme-labs/ayme/commit/6b72ab4ab5ed7cd2846807edfef3bafcc672e6ca))
* ayme_inspect shows the Inspector inside agent apps that support MCP Apps ([#1314](https://github.com/ayme-labs/ayme/issues/1314)) ([8b27ddd](https://github.com/ayme-labs/ayme/commit/8b27ddd02278151db53ec666239f61f82a024c12))
* **ayme:** move the Page Object compiler behind a Node-only compiler entry ([#1222](https://github.com/ayme-labs/ayme/issues/1222)) ([9cacd7b](https://github.com/ayme-labs/ayme/commit/9cacd7bfe7fcd408ee6a4ed53e1c00f29234b894))
* **ayme:** one in-page module per document ([#1169](https://github.com/ayme-labs/ayme/issues/1169)) ([3b742de](https://github.com/ayme-labs/ayme/commit/3b742dec64148b2e47d067a9f9d2396671c9ee0b))
* mark irreversible actions destructive for agents ([#1321](https://github.com/ayme-labs/ayme/issues/1321)) ([6a6b7d3](https://github.com/ayme-labs/ayme/commit/6a6b7d3971cceb1d8481a313765b8d62101a4bbe))


### Bug Fixes

* **ayme:** preserve single literals in tool input schemas ([#1451](https://github.com/ayme-labs/ayme/issues/1451)) ([440cc5a](https://github.com/ayme-labs/ayme/commit/440cc5a37903d86a82e94de9afe305a7257b2745))

## [0.2.0](https://github.com/ayme-labs/ayme/compare/inspector-v0.1.1...inspector-v0.2.0) (2026-11-04)


### Features

* declare Page Object Children with [@ayme](https://github.com/ayme).child and [@ayme](https://github.com/ayme).collection ([#1136](https://github.com/ayme-labs/ayme/issues/1136)) ([6f73ff6](https://github.com/ayme-labs/ayme/commit/6f73ff6eac0c18726f42d84d94bbaae214d1f22b))
* **inspector:** make Runs targets readable ([#1143](https://github.com/ayme-labs/ayme/issues/1143)) ([5d290de](https://github.com/ayme-labs/ayme/commit/5d290ded79e3887d48dc4513e3031405b1e0132c))
* publish a Page Object Action's destructured parameter as input fields ([#1135](https://github.com/ayme-labs/ayme/issues/1135)) ([1407099](https://github.com/ayme-labs/ayme/commit/14070990c738bd9ac72f78167b24d4c1cc81ed0b))

## [0.1.1](https://github.com/ayme-labs/ayme/compare/inspector-v0.1.0...inspector-v0.1.1) (2026-10-30)


### Miscellaneous Chores

* request 0.1.1 to validate trusted publishing ([#1096](https://github.com/ayme-labs/ayme/issues/1096)) ([947f554](https://github.com/ayme-labs/ayme/commit/947f554464c7f0a3c1473f79991af3a830b5cc61))
* request 0.1.1 to validate trusted publishing ([#1096](https://github.com/ayme-labs/ayme/issues/1096)) ([32b57f3](https://github.com/ayme-labs/ayme/commit/32b57f31a929c00644cdb3677f2f55a283a54692))

## 0.1.0 (2026-10-30)


### Miscellaneous Chores

* **inspector:** Synchronize ayme versions
