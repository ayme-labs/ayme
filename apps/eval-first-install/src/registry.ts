/**
 * A throwaway npm registry: Verdaccio, holding the ref's `@ayme-dev/*`
 * tarballs and passing everything else through to npmjs.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

export const VERDACCIO = "verdaccio@6.11.1";

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port"))
      );
    });
  });
}

export type Registry = { url: string; stop: () => void };

export async function startRegistry(
  dir: string,
  logFile: string
): Promise<Registry> {
  mkdirSync(join(dir, "storage"), { recursive: true });
  const port = await freePort();
  const config = join(dir, "config.yaml");
  writeFileSync(
    config,
    `storage: ${join(dir, "storage")}
auth:
  htpasswd:
    file: ${join(dir, "htpasswd")}
    max_users: 1
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
    timeout: 60s
packages:
  "@*/*":
    access: $all
    publish: $authenticated
    proxy: npmjs
  "**":
    access: $all
    publish: $authenticated
    proxy: npmjs
web:
  enable: false
log: { type: stdout, format: pretty, level: warn }
`
  );
  const out = openSync(logFile, "a");
  const child = spawn(
    "npx",
    ["-y", VERDACCIO, "--config", config, "--listen", `127.0.0.1:${port}`],
    { cwd: dir, detached: true, stdio: ["ignore", out, out] }
  );
  const url = `http://127.0.0.1:${port}/`;
  const stop = () => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  };
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      if ((await fetch(`${url}-/ping`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (child.exitCode !== null || Date.now() > deadline) {
      stop();
      throw new Error(`Verdaccio did not start; see ${logFile}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { url, stop };
}

/** Publishes the tarballs under the dist-tag `first-install`, as a throwaway user. */
export async function publish(
  registryUrl: string,
  tarballs: string[],
  dir: string
): Promise<void> {
  const response = await fetch(
    `${registryUrl}-/user/org.couchdb.user:harness`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "harness", password: "harness-password" }),
    }
  );
  const { token } = (await response.json()) as { token?: string };
  if (!token)
    throw new Error(`Verdaccio refused the harness user: ${response.status}`);
  const npmrc = join(dir, "publish.npmrc");
  const host = registryUrl.replace(/^https?:/, "");
  writeFileSync(
    npmrc,
    `registry=${registryUrl}\n${host}:_authToken=${token}\n`
  );
  for (const tarball of tarballs) {
    execFileSync(
      "npm",
      [
        "publish",
        tarball,
        "--tag",
        "first-install",
        "--userconfig",
        npmrc,
        "--registry",
        registryUrl,
      ],
      { stdio: ["ignore", "inherit", "inherit"], cwd: dir }
    );
  }
}
