// Preloaded via NODE_OPTIONS: records the Node version and entry script of every Node process the probe starts.
require("fs").appendFileSync(
  process.env.AYME_NODE_TRACE,
  `${process.version} ${process.argv.slice(1, 3).join(" ")}\n`
);
