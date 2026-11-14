# Changelog

## [0.3.0](https://github.com/ayme-labs/ayme/compare/ayme-v0.2.0...ayme-v0.3.0) (2026-11-14)


### Features

* **ayme:** move the Page Object compiler behind a Node-only compiler entry ([#1222](https://github.com/ayme-labs/ayme/issues/1222)) ([9cacd7b](https://github.com/ayme-labs/ayme/commit/9cacd7bfe7fcd408ee6a4ed53e1c00f29234b894))
* **ayme:** one in-page module per document ([#1169](https://github.com/ayme-labs/ayme/issues/1169)) ([3b742de](https://github.com/ayme-labs/ayme/commit/3b742dec64148b2e47d067a9f9d2396671c9ee0b))
* **skills:** add the ayme-recorder skill and share page object design across skills ([#1198](https://github.com/ayme-labs/ayme/issues/1198)) ([860c240](https://github.com/ayme-labs/ayme/commit/860c240de4197bc59ff638cfb3e15a582c64848c))


### Bug Fixes

* **core:** attribute a before observation to the action before it ([#1163](https://github.com/ayme-labs/ayme/issues/1163)) ([c8e807f](https://github.com/ayme-labs/ayme/commit/c8e807f2f0a6eae78ac0934a75327775c45a1f46))
* **core:** treat query-only URL changes as navigation within the current visit ([#1164](https://github.com/ayme-labs/ayme/issues/1164)) ([872975d](https://github.com/ayme-labs/ayme/commit/872975d5e054c2a32297dc741a642143fa8dba04)), closes [#1157](https://github.com/ayme-labs/ayme/issues/1157)
* **mcp:** give served Page Object build failures a location and no advice ([e951220](https://github.com/ayme-labs/ayme/commit/e951220d5cac234556942ef03c9721946acc8c8a)), closes [#1247](https://github.com/ayme-labs/ayme/issues/1247) [#1248](https://github.com/ayme-labs/ayme/issues/1248)
* **mcp:** keep served Page Object errors at source positions ([#1290](https://github.com/ayme-labs/ayme/issues/1290)) ([fded0db](https://github.com/ayme-labs/ayme/commit/fded0db52acf9f1351966dd9719817f8b1c99d88))

## [0.2.0](https://github.com/ayme-labs/ayme/compare/ayme-v0.1.1...ayme-v0.2.0) (2026-11-04)


### Features

* declare Page Object Children with [@ayme](https://github.com/ayme).child and [@ayme](https://github.com/ayme).collection ([#1136](https://github.com/ayme-labs/ayme/issues/1136)) ([6f73ff6](https://github.com/ayme-labs/ayme/commit/6f73ff6eac0c18726f42d84d94bbaae214d1f22b))
* **inspector:** make Runs targets readable ([#1143](https://github.com/ayme-labs/ayme/issues/1143)) ([5d290de](https://github.com/ayme-labs/ayme/commit/5d290ded79e3887d48dc4513e3031405b1e0132c))
* publish a Page Object Action's destructured parameter as input fields ([#1135](https://github.com/ayme-labs/ayme/issues/1135)) ([1407099](https://github.com/ayme-labs/ayme/commit/14070990c738bd9ac72f78167b24d4c1cc81ed0b))

## [0.1.1](https://github.com/ayme-labs/ayme/compare/ayme-v0.1.0...ayme-v0.1.1) (2026-10-30)


### Miscellaneous Chores

* request 0.1.1 to validate trusted publishing ([#1096](https://github.com/ayme-labs/ayme/issues/1096)) ([947f554](https://github.com/ayme-labs/ayme/commit/947f554464c7f0a3c1473f79991af3a830b5cc61))
* request 0.1.1 to validate trusted publishing ([#1096](https://github.com/ayme-labs/ayme/issues/1096)) ([32b57f3](https://github.com/ayme-labs/ayme/commit/32b57f31a929c00644cdb3677f2f55a283a54692))

## 0.1.0 (2026-10-30)


### Bug Fixes

* **ayme:** hand back done only when the model is confident the goal holds ([#1064](https://github.com/ayme-labs/ayme/issues/1064)) ([71cc104](https://github.com/ayme-labs/ayme/commit/71cc1042eb138c4884417db1befe27e581aaf7b9))
