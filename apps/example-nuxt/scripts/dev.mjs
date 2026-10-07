// Starts `nuxt dev`, but fails when the requested port is taken. Nuxt dev has
// no strict-port flag: it quietly moves to another port instead.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";
import { parseArgs } from "node:util";

const args = process.argv.slice(2);

// Parsed like Nuxt's own flags, aliases included. The last value wins, so
// `pnpm dev --port <n>` overrides the default port.
const { values } = parseArgs({
  args,
  options: {
    port: { type: "string", short: "p" },
    host: { type: "string", short: "h" },
  },
  strict: false,
  allowPositionals: true,
});
const port = Number(values.port);
const { host } = values;

// ponytail: the port is released before Nuxt binds it, so another process
//   could take it in between.
const probe = createServer()
  .once("error", (error) => {
    process.stderr.write(
      `Port ${port} on ${host} is unavailable: ${error.message}\n`
    );
    process.exit(1);
  })
  .listen(port, host, () =>
    probe.close(() => {
      const nuxt = spawn("nuxt", ["dev", ...args], { stdio: "inherit" });
      for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => nuxt.kill(signal));
      }
      nuxt.on("exit", (code, signal) => {
        process.exitCode = code ?? (signal ? 1 : 0);
      });
    })
  );
