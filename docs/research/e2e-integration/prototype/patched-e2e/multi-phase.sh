#!/bin/sh
# Usage: multi-phase.sh <arm> <phase> [e2e run args...]: one multi-act phase, gated on load below 9.
arm=$1 phase=$2; shift 2
while [ "$(sysctl -n vm.loadavg | awk '{print ($2 < 9) ? 1 : 0}')" != "1" ]; do echo "load high, waiting: $(sysctl -n vm.loadavg)"; sleep 30; done
SPIKE_TESTS='tests-multi/**/*.e2e.ts' SPIKE_CONFIG_NAME=claude-multi-$arm ./run-phase.sh claude "$arm" "$phase" read-write "$@"
