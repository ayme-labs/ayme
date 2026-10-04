#!/bin/sh
# pnpm 11 needs Node >= 22.13: run pnpm itself on Devbox Node 24; scripts it spawns resolve `node` from PATH (Node 20.19.0).
exec "/nix/store/…-nodejs-slim-24.21.0/bin/node" ~/.cache/node/corepack/v1/pnpm/11.24.0/bin/pnpm.mjs "$@"
