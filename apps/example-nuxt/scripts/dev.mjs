// Starts `nuxt dev`, but fails when the requested port is taken. Nuxt dev has
// no strict-port flag: it quietly moves to another port instead.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";

const args = process.argv.slice(2);

// The last value wins, so `pnpm dev --port <n>` overrides the default port.
const lastValue = (name) =>
  args.reduce((value, arg, index) => {
    if (arg === name) return args[index + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    return value;
  }, undefined);

const port = Number(lastValue("--port"));
const host = lastValue("--host");

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
