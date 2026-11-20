# Changelog

## [0.3.0](https://github.com/ayme-labs/ayme/compare/mcp-v0.2.0...mcp-v0.3.0) (2026-11-20)


### Features

* ayme_inspect shows the Inspector inside agent apps that support MCP Apps ([#1314](https://github.com/ayme-labs/ayme/issues/1314)) ([8b27ddd](https://github.com/ayme-labs/ayme/commit/8b27ddd02278151db53ec666239f61f82a024c12))
* **ayme:** one in-page module per document ([#1169](https://github.com/ayme-labs/ayme/issues/1169)) ([3b742de](https://github.com/ayme-labs/ayme/commit/3b742dec64148b2e47d067a9f9d2396671c9ee0b))
* mark irreversible actions destructive for agents ([#1321](https://github.com/ayme-labs/ayme/issues/1321)) ([6a6b7d3](https://github.com/ayme-labs/ayme/commit/6a6b7d3971cceb1d8481a313765b8d62101a4bbe))
* **mcp:** serve .ayme/page-objects.ts to a page that doesn't ship Ayme ([#1219](https://github.com/ayme-labs/ayme/issues/1219)) ([76ef1f7](https://github.com/ayme-labs/ayme/commit/76ef1f7f93b9f2fd78820219f7b93160106ec1f0))
* **mcp:** serve MCP revision 2026-07-28 and keep answering the older revisions ([#1324](https://github.com/ayme-labs/ayme/issues/1324)) ([3e98eca](https://github.com/ayme-labs/ayme/commit/3e98eca48e6dbdca4da65c1ae5d71d2aeff88d06))


### Bug Fixes

* **ayme:** report Page Object compile errors as located diagnostics ([#1301](https://github.com/ayme-labs/ayme/issues/1301)) ([d3a5b22](https://github.com/ayme-labs/ayme/commit/d3a5b222e9d1ce9b402f639ce7f03bbe49ac93de))
* keep a Page Object compile error's source line on the way to esbuild ([#1309](https://github.com/ayme-labs/ayme/issues/1309)) ([6bf5640](https://github.com/ayme-labs/ayme/commit/6bf5640b4880582a3fb0eed9ecadb021e932105b))
* locate a tsconfig option error, and list a tsconfig mistake once in ayme mcp ([#1310](https://github.com/ayme-labs/ayme/issues/1310)) ([4d78bea](https://github.com/ayme-labs/ayme/commit/4d78bea9e01bac3d5e5d22ee993ea0d122b58224))
* **mcp:** give served Page Object build failures a location and no advice ([e951220](https://github.com/ayme-labs/ayme/commit/e951220d5cac234556942ef03c9721946acc8c8a)), closes [#1247](https://github.com/ayme-labs/ayme/issues/1247) [#1248](https://github.com/ayme-labs/ayme/issues/1248)
* **mcp:** keep served Page Object errors at source positions ([#1290](https://github.com/ayme-labs/ayme/issues/1290)) ([fded0db](https://github.com/ayme-labs/ayme/commit/fded0db52acf9f1351966dd9719817f8b1c99d88))
* **mcp:** keep the stored tab id when reopening a connect link ([#1291](https://github.com/ayme-labs/ayme/issues/1291)) ([08d0bd5](https://github.com/ayme-labs/ayme/commit/08d0bd57d56f8fcbe253550fc7029ccaa9d86c10))
* **mcp:** omit once-it-builds note when ayme_connect is not watching ([#1289](https://github.com/ayme-labs/ayme/issues/1289)) ([a1c5078](https://github.com/ayme-labs/ayme/commit/a1c5078270a909e40691247d30264da5c99404fb))
* **mcp:** report served compiler errors at their own positions ([#1294](https://github.com/ayme-labs/ayme/issues/1294)) ([f9b7a2f](https://github.com/ayme-labs/ayme/commit/f9b7a2f3d60655615310498528ecce0f19a51990))
* **mcp:** say why when the served Page Objects never built ([#1236](https://github.com/ayme-labs/ayme/issues/1236)) ([47838f0](https://github.com/ayme-labs/ayme/commit/47838f005f8ec37ac6b39e6fbfbc85e90ab79e3c)), closes [#1234](https://github.com/ayme-labs/ayme/issues/1234)
* **mcp:** start no served runtime on a page whose app ships Ayme ([#1226](https://github.com/ayme-labs/ayme/issues/1226)) ([5f39f91](https://github.com/ayme-labs/ayme/commit/5f39f914c1c6675cb1b8f407058a713f395adcbb)), closes [#1223](https://github.com/ayme-labs/ayme/issues/1223)
* **mcp:** stop the served build when the project's @ayme-dev/ayme is another version ([#1338](https://github.com/ayme-labs/ayme/issues/1338)) ([8ae6b43](https://github.com/ayme-labs/ayme/commit/8ae6b437b64ba3cff77cfd5461604961aefb3606))

## [0.2.0](https://github.com/ayme-labs/ayme/compare/mcp-v0.1.1...mcp-v0.2.0) (2026-11-04)


### Bug Fixes

* **mcp:** print usage on --help and -h and exit 0 ([#1108](https://github.com/ayme-labs/ayme/issues/1108)) ([8b03ec0](https://github.com/ayme-labs/ayme/commit/8b03ec010157645c8a381ef6dfe02cf841a597f4))

## [0.1.1](https://github.com/ayme-labs/ayme/compare/mcp-v0.1.0...mcp-v0.1.1) (2026-10-30)


### Miscellaneous Chores

* request 0.1.1 to validate trusted publishing ([#1096](https://github.com/ayme-labs/ayme/issues/1096)) ([947f554](https://github.com/ayme-labs/ayme/commit/947f554464c7f0a3c1473f79991af3a830b5cc61))
* request 0.1.1 to validate trusted publishing ([#1096](https://github.com/ayme-labs/ayme/issues/1096)) ([32b57f3](https://github.com/ayme-labs/ayme/commit/32b57f31a929c00644cdb3677f2f55a283a54692))

## 0.1.0 (2026-10-30)


### Miscellaneous Chores

* **mcp:** Synchronize ayme versions
