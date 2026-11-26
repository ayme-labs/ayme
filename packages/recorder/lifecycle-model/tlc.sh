#!/bin/sh
# Usage: ./tlc.sh <config name without .cfg> [more TLC flags]
# Checks one config with the stock TLC model checker alone, with one worker.
# TLA2TOOLS is the path to tla2tools.jar (1.7.4 or later); JAVA a Java 11 or
# later (default: java on the PATH); TLC_HEAP the most memory TLC may take
# (default 2g). TLC stops at the first rule that breaks and prints the path
# to it; add -continue to go on past it.
here=$(cd "$(dirname "$0")" && pwd)
jar=${TLA2TOOLS:?Set TLA2TOOLS to the path of tla2tools.jar (README, "Running it").}
cfg=${1:?Name a config, as Rules.}
shift
meta=$(mktemp -d)
cd "$here" && "${JAVA:-java}" -Xmx"${TLC_HEAP:-2g}" -XX:+UseParallelGC -cp "$jar" \
  tlc2.TLC -workers 1 -metadir "$meta" -config "$cfg.cfg" "$@" Recorder.tla
code=$?
rm -rf "$meta"
exit $code
