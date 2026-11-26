# Changelog

## [0.3.0](https://github.com/ayme-labs/ayme/compare/unplugin-ayme-v0.2.0...unplugin-ayme-v0.3.0) (2026-11-26)


### ⚠ BREAKING CHANGES

* `ayme mcp` and the Recorder no longer read or write `.ayme/`. Move the folder to `ayme/`.

### Features

* **ayme:** move the Page Object compiler behind a Node-only compiler entry ([#1222](https://github.com/ayme-labs/ayme/issues/1222)) ([9cacd7b](https://github.com/ayme-labs/ayme/commit/9cacd7bfe7fcd408ee6a4ed53e1c00f29234b894))
* **ayme:** support TypeScript 7 projects through @typescript/typescript6 ([#1478](https://github.com/ayme-labs/ayme/issues/1478)) ([a02de94](https://github.com/ayme-labs/ayme/commit/a02de94fc1264bb3bc88a17326d27a753c44e0a4))
* keep everything ayme in an ayme/ folder, without a dot ([#1425](https://github.com/ayme-labs/ayme/issues/1425)) ([dd0c6fe](https://github.com/ayme-labs/ayme/commit/dd0c6fe3a32d3a63aaf98297a8973c30895af044))


### Bug Fixes

* **ayme:** report Page Object compile errors as located diagnostics ([#1301](https://github.com/ayme-labs/ayme/issues/1301)) ([d3a5b22](https://github.com/ayme-labs/ayme/commit/d3a5b222e9d1ce9b402f639ce7f03bbe49ac93de))
* keep a Page Object compile error's source line on the way to esbuild ([#1309](https://github.com/ayme-labs/ayme/issues/1309)) ([6bf5640](https://github.com/ayme-labs/ayme/commit/6bf5640b4880582a3fb0eed9ecadb021e932105b))
* **mcp:** give served Page Object build failures a location and no advice ([e951220](https://github.com/ayme-labs/ayme/commit/e951220d5cac234556942ef03c9721946acc8c8a)), closes [#1247](https://github.com/ayme-labs/ayme/issues/1247) [#1248](https://github.com/ayme-labs/ayme/issues/1248)
* **react:** take a new Page Object model from Fast Refresh instead of throwing ([#1458](https://github.com/ayme-labs/ayme/issues/1458)) ([9624388](https://github.com/ayme-labs/ayme/commit/9624388595b6edecadb3f7fa663a24588a0413a4))

## [0.2.0](https://github.com/ayme-labs/ayme/compare/unplugin-ayme-v0.1.1...unplugin-ayme-v0.2.0) (2026-11-04)


### Features

* declare Page Object Children with [@ayme](https://github.com/ayme).child and [@ayme](https://github.com/ayme).collection ([#1136](https://github.com/ayme-labs/ayme/issues/1136)) ([6f73ff6](https://github.com/ayme-labs/ayme/commit/6f73ff6eac0c18726f42d84d94bbaae214d1f22b))
* publish a Page Object Action's destructured parameter as input fields ([#1135](https://github.com/ayme-labs/ayme/issues/1135)) ([1407099](https://github.com/ayme-labs/ayme/commit/14070990c738bd9ac72f78167b24d4c1cc81ed0b))

## [0.1.1](https://github.com/ayme-labs/ayme/compare/unplugin-ayme-v0.1.0...unplugin-ayme-v0.1.1) (2026-10-30)


### Miscellaneous Chores

* request 0.1.1 to validate trusted publishing ([#1096](https://github.com/ayme-labs/ayme/issues/1096)) ([947f554](https://github.com/ayme-labs/ayme/commit/947f554464c7f0a3c1473f79991af3a830b5cc61))
* request 0.1.1 to validate trusted publishing ([#1096](https://github.com/ayme-labs/ayme/issues/1096)) ([32b57f3](https://github.com/ayme-labs/ayme/commit/32b57f31a929c00644cdb3677f2f55a283a54692))

## 0.1.0 (2026-10-30)


### Miscellaneous Chores

* **unplugin-ayme:** Synchronize ayme versions
