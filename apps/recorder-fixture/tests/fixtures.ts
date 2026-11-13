import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

/** This app's folder: a project with Playwright installed. */
export const fixtureProject = fileURLToPath(new URL("..", import.meta.url));

// The built command, found as a project finds it: through the package's bin.
const cliManifest = createRequire(import.meta.url).resolve(
  "@ayme-dev/cli/package.json"
);
const cliCommand = join(
  dirname(cliManifest),
  (
    JSON.parse(await readFile(cliManifest, "utf8")) as {
      bin: Record<string, string>;
    }
  ).bin["ayme-recorder"]!
);

// The port is released before the browser binds it, so another process could
// take it in between; the browser then fails to launch and so does the test.
const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createNetServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });

/** The fixture pages, served for one test. */
export type FixturePages = {
  /** The address of a page in `app/`, such as `/closes-itself.html`. */
  url(path?: string): string;
  /** Every request so far, in order. */
  readonly requests: readonly { path: string; userAgent: string }[];
};

/** One run of `ayme-recorder`, as a child process. */
export type Run = {
  /** Everything it has written to stdout so far. */
  stdout(): string;
  stderr(): string;
  /** Resolves once stdout holds `text`. */
  waitForStdout(text: string): Promise<void>;
  /** Sends the signal the terminal's stop sends. */
  interrupt(): void;
  /** Closes the page at `url` in the recorder's browser, as the person
   * would, over the test's own connection to that browser. */
  closePage(url: string): Promise<void>;
  /** How it ended. */
  readonly exit: Promise<{ code: number | null; signal: string | null }>;
};

export const test = base.extend<{
  fixturePages: FixturePages;
  /** Runs `ayme-recorder` with these arguments in a project folder. */
  runRecorder: (args: string[], options?: { cwd?: string }) => Promise<Run>;
}>({
  // eslint-disable-next-line no-empty-pattern
  fixturePages: async ({}, use) => {
    const requests: { path: string; userAgent: string }[] = [];
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://fixture").pathname;
      requests.push({ path, userAgent: request.headers["user-agent"] ?? "" });
      readFile(join(fixtureProject, "app", path === "/" ? "index.html" : path))
        .then((page) => {
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(page);
        })
        .catch(() => {
          response.statusCode = 404;
          response.end();
        });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const { port } = server.address() as AddressInfo;
    await use({
      url: (path = "/") => `http://127.0.0.1:${port}${path}`,
      requests,
    });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  },

  // eslint-disable-next-line no-empty-pattern
  runRecorder: async ({}, use) => {
    const children: ReturnType<typeof spawn>[] = [];
    await use(async (args, { cwd = fixtureProject } = {}) => {
      const debugPort = await freePort();
      const child = spawn(process.execPath, [cliCommand, ...args], {
        cwd,
        env: {
          ...process.env,
          // The tests run where there is no screen.
          AYME_RECORDER_HEADLESS: "1",
          // The test's own way into the recorder's browser.
          AYME_RECORDER_DEBUG_PORT: String(debugPort),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      let stdout = "";
      let stderr = "";
      const waiting: (() => void)[] = [];
      child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        for (const check of waiting) check();
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const exit = new Promise<{ code: number | null; signal: string | null }>(
        (resolve) =>
          child.on("exit", (code, signal) => {
            resolve({ code, signal });
            for (const check of waiting) check();
          })
      );
      return {
        stdout: () => stdout,
        stderr: () => stderr,
        waitForStdout: (text) =>
          new Promise<void>((resolve, reject) => {
            const check = () => {
              if (stdout.includes(text)) resolve();
              else if (child.exitCode !== null || child.signalCode !== null)
                reject(
                  new Error(
                    `ayme-recorder ended before printing "${text}".\nstdout: ${stdout}\nstderr: ${stderr}`
                  )
                );
            };
            waiting.push(check);
            check();
          }),
        interrupt: () => void child.kill("SIGINT"),
        closePage: async (url) => {
          // The browser's DevTools protocol, over its HTTP endpoints.
          const devtools = `http://127.0.0.1:${debugPort}/json`;
          const targets = (await (await fetch(`${devtools}/list`)).json()) as {
            id: string;
            type: string;
            url: string;
          }[];
          const page = targets.find(
            (target) => target.type === "page" && target.url === url
          );
          if (!page)
            throw new Error(
              `No page at ${url} in the recorder's browser: ${JSON.stringify(targets)}`
            );
          await fetch(`${devtools}/close/${page.id}`);
        },
        exit,
      };
    });
    // A run a failed test left behind takes its browser with it.
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
  },
});
