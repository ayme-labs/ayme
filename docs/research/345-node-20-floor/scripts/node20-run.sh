#!/bin/sh
# Usage: node20-run.sh <next|nuxt> <label>
# Runs probe.sh with Node 20.19.0 first in PATH and pnpm shimmed onto Node 24.
# Every Node process records its version and entry script in node-trace.txt.
S=<node20>
L=<logs>
export PATH=$S/shim:$S/node-v20.19.0-darwin-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin
export PROBE_LOGS=$L/node20
mkdir -p $PROBE_LOGS/$2
export AYME_NODE_TRACE=$PROBE_LOGS/$2/node-trace.txt
: > $AYME_NODE_TRACE
export NODE_OPTIONS="--require $L/record-node.cjs"
cd <worktree> && sh $L/probe-pub.sh "$1" "$2"
