# Changelog

## [0.3.3](https://github.com/ayme-labs/ayme/compare/cli-v0.3.2...cli-v0.3.3) (2026-11-28)


### Bug Fixes

* **recorder:** save the recording when the terminal closes or a page calls the recorder's functions ([#1530](https://github.com/ayme-labs/ayme/issues/1530)) ([460932c](https://github.com/ayme-labs/ayme/commit/460932ca9d6a6daa501be2f4e836eaf0160e198f))

## [0.3.2](https://github.com/ayme-labs/ayme/compare/cli-v0.3.1...cli-v0.3.2) (2026-11-27)


### Bug Fixes

* **cli:** say in the README that the recorder prints warnings and goes on ([#1523](https://github.com/ayme-labs/ayme/issues/1523)) ([a4ab651](https://github.com/ayme-labs/ayme/commit/a4ab651f6839df3cfb3f2d11c16a32b659ee72e0))
* **recorder:** keep the page's open popover open on a press on the toolbar ([#1515](https://github.com/ayme-labs/ayme/issues/1515)) ([04708ab](https://github.com/ayme-labs/ayme/commit/04708ab66d0ae4051859bede8ad40fd9128301aa))
* **recorder:** keep recording when a piece of the worker's own work throws ([#1519](https://github.com/ayme-labs/ayme/issues/1519)) ([84c4b66](https://github.com/ayme-labs/ayme/commit/84c4b66e454c07df459b403902cfa79236227088))
* **recorder:** keep a recording going when a page read or a step's changes cannot be worked out ([#1520](https://github.com/ayme-labs/ayme/issues/1520)) ([e1ae18b](https://github.com/ayme-labs/ayme/commit/e1ae18b7df50981454058b5e6c4583f14cce0811))

## [0.3.1](https://github.com/ayme-labs/ayme/compare/cli-v0.3.0...cli-v0.3.1) (2026-11-27)


### Bug Fixes

* **recorder:** stop a page that wraps moved content from crashing a recording ([#1512](https://github.com/ayme-labs/ayme/issues/1512)) ([59afc29](https://github.com/ayme-labs/ayme/commit/59afc291c45e6fe0e8710a783aa22fa7e35f95bd))
* **recorder:** keep one ref per element after a second re-creation, and label by the page after ([#1513](https://github.com/ayme-labs/ayme/issues/1513)) ([c3594e9](https://github.com/ayme-labs/ayme/commit/c3594e93252e0a7e71cdae74d7b4195ae83e48ab))

## 0.3.0 (2026-11-26)


### ⚠ BREAKING CHANGES

* `ayme mcp` and the Recorder no longer read or write `.ayme/`. Move the folder to `ayme/`.

### Features

* **cli:** codegen --load-storage and --save-storage ([#1387](https://github.com/ayme-labs/ayme/issues/1387)) ([3131c15](https://github.com/ayme-labs/ayme/commit/3131c15e2811c214df98df5b902e67e3195dbccc))
* **cli:** drop codegen --headed, which is the default ([#1378](https://github.com/ayme-labs/ayme/issues/1378)) ([72c08d1](https://github.com/ayme-labs/ayme/commit/72c08d19373a4e17b8fbfb7943f49e86dcce8cab))
* **cli:** print the installed version for ayme-recorder --version ([#1376](https://github.com/ayme-labs/ayme/issues/1376)) ([5ae605c](https://github.com/ayme-labs/ayme/commit/5ae605cb90a6878ac34b4260db6aea4b43cebd22))
* keep everything ayme in an ayme/ folder, without a dot ([#1425](https://github.com/ayme-labs/ayme/issues/1425)) ([dd0c6fe](https://github.com/ayme-labs/ayme/commit/dd0c6fe3a32d3a63aaf98297a8973c30895af044))
* **recorder-window:** fold list rows of one role, and hide cursor-only changes ([#1384](https://github.com/ayme-labs/ayme/issues/1384)) ([4cb3189](https://github.com/ayme-labs/ayme/commit/4cb3189591cf9ece1f4fb49a227029cc493797b4))
* **recorder:** discard and restore a step while recording, without pausing ([#1388](https://github.com/ayme-labs/ayme/issues/1388)) ([dd17907](https://github.com/ayme-labs/ayme/commit/dd1790724373d0cd6c1d34b37bf2714b14d11d1a))
* **recorder:** rebuild the recorder on stock Playwright ([#1285](https://github.com/ayme-labs/ayme/issues/1285)) ([acaa6d1](https://github.com/ayme-labs/ayme/commit/acaa6d1f39d51686ca9269f9fd5b788b3ec5e400))
* **recorder:** stop recording screenshots into the trace ([#1379](https://github.com/ayme-labs/ayme/issues/1379)) ([69d6f6d](https://github.com/ayme-labs/ayme/commit/69d6f6d249654f41c1dd642f5aef500d5c246112))
