# Changelog

## [0.3.0](https://github.com/ayme-labs/ayme/compare/cli-v0.2.0...cli-v0.3.0) (2026-11-26)


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
