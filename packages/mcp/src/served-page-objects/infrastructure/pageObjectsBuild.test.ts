import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { startPageObjects, startWithInstall } from "./pageObjectsBuild";
import type { PageObjectsBuildEvent } from "./pageObjectsBundler";
import type { ProjectAymeInstall } from "./projectAymeInstall";

type Resolution = Awaited<ReturnType<ProjectAymeInstall["resolve"]>>;

const entry = "/project/ayme/page-objects.ts";
const install = {
  folder: "/project",
  packageManager: "pnpm",
  workspaceRoot: false,
} as const;
const installFiles = ["/project/package.json", "/project/pnpm-lock.yaml"];
const mismatch = {
  kind: "cannot-start",
  compiler: "/project/node_modules/@ayme-dev/ayme/compiler.js",
  version: "0.1.0",
  install,
  error: "The project's ayme version does not match.",
} as const;
const ready = {
  kind: "ready",
  version: "0.2.0",
  install,
  compiler: "/project/node_modules/@ayme-dev/ayme/compiler.js",
} as const;
const modules = new Map([["entry.js", "export default []"]]);

function start(
  initial: Resolution = mismatch,
  first: PageObjectsBuildEvent = { kind: "built", modules }
) {
  let changed = () => {};
  let failed = () => {};
  let publish!: (event: PageObjectsBuildEvent) => void;
  const stopWatching = vi.fn();
  const closeBuild = vi.fn(async () => {});
  const resolve = vi
    .fn<ProjectAymeInstall["resolve"]>()
    .mockResolvedValue(initial);
  const subscribe = vi.fn<ProjectAymeInstall["subscribe"]>(
    (onChanged, onFailed) => {
      changed = onChanged;
      failed = onFailed;
      return { files: installFiles, stop: stopWatching };
    }
  );
  const bundle = vi.fn(async (_compiler: string, emit: typeof publish) => {
    publish = emit;
    publish({ kind: "building" });
    publish(first);
    return closeBuild;
  });
  const log = vi.fn();
  const build = startWithInstall(entry, log, { resolve, subscribe }, bundle);
  return {
    build,
    resolve,
    subscribe,
    log,
    bundle,
    stopWatching,
    closeBuild,
    change: () => changed(),
    fail: () => failed(),
    publish: (event: PageObjectsBuildEvent) => publish(event),
  };
}

it("starts when a matching install arrives without restarting the server", async ({
  onTestFinished,
}) => {
  const { build, resolve, change, bundle, stopWatching, closeBuild, log } =
    start();
  onTestFinished(() => build.close());
  expect(build.state).toEqual({ kind: "starting", entry });
  const listener = vi.fn();
  build.subscribe(listener);
  expect(await build.whenSettled()).toEqual({
    kind: "watching-install",
    entry,
    error: mismatch.error,
    installFiles,
  });
  expect(bundle).not.toHaveBeenCalled();

  resolve.mockResolvedValue(ready);
  change();
  await expect.poll(() => build.state.kind).toBe("built");

  expect(listener).toHaveBeenCalledWith({ kind: "building", entry });
  expect(listener).toHaveBeenLastCalledWith({ kind: "built", entry, modules });
  expect(bundle).toHaveBeenCalledExactlyOnceWith(
    ready.compiler,
    expect.any(Function)
  );
  expect(stopWatching).toHaveBeenCalledOnce();
  expect(log.mock.calls).toEqual([
    [mismatch.error],
    [`Built the Page Objects entry ${entry}.`],
  ]);
  expect(closeBuild).not.toHaveBeenCalled();
});

it("keeps watching an install that never resolves", async ({
  onTestFinished,
}) => {
  const { build, subscribe, change, bundle, stopWatching } = start({
    ...mismatch,
    version: undefined,
    compiler: undefined,
    error: "The project's ayme package does not resolve.",
  });
  onTestFinished(() => build.close());
  const waiting = await build.whenSettled();
  change();

  await expect.poll(() => subscribe.mock.calls.length).toBe(2);
  expect(subscribe).toHaveBeenNthCalledWith(
    1,
    expect.any(Function),
    expect.any(Function),
    []
  );
  expect(subscribe).toHaveBeenLastCalledWith(
    expect.any(Function),
    expect.any(Function),
    installFiles
  );
  expect(build.state).toEqual(waiting);
  expect(stopWatching).toHaveBeenCalledOnce();
  expect(bundle).not.toHaveBeenCalled();
});

it("checks the install again when asked for an answer and starts even when no watch event arrives", async ({
  onTestFinished,
}) => {
  const { build, resolve, log } = start();
  onTestFinished(() => build.close());
  const waiting = await build.whenSettled();
  expect(await build.whenSettled()).toBe(waiting);
  expect(log).toHaveBeenCalledExactlyOnceWith(mismatch.error);

  resolve.mockResolvedValue({
    ...mismatch,
    error: "A different version is installed.",
  });
  expect(await build.whenSettled()).toMatchObject({
    kind: "watching-install",
    error: "A different version is installed.",
  });
  expect(log).toHaveBeenCalledTimes(2);

  resolve.mockResolvedValue(ready);
  expect(await build.whenSettled()).toEqual({ kind: "built", entry, modules });
});

it("still answers with the install it waits for when checking the install again throws", async ({
  onTestFinished,
}) => {
  const { build, resolve, log } = start();
  onTestFinished(() => build.close());
  const waiting = await build.whenSettled();
  expect(waiting.kind).toBe("watching-install");
  resolve.mockRejectedValue(new Error("The service was stopped"));

  expect(await build.whenSettled()).toBe(waiting);
  expect(log).toHaveBeenCalledExactlyOnceWith(mismatch.error);
});

it("publishes when the install watcher stops, keeping the original failure and log", async ({
  onTestFinished,
}) => {
  const { build, fail, log } = start();
  onTestFinished(() => build.close());
  await build.whenSettled();
  const changed = vi.fn();
  build.subscribe(changed);

  fail();

  expect(build.state).toEqual({
    kind: "cannot-start",
    entry,
    error: mismatch.error,
  });
  expect(changed).toHaveBeenCalledExactlyOnceWith(build.state);
  expect(log).toHaveBeenCalledExactlyOnceWith(mismatch.error);
});

it("stops watching the install files once closed", async () => {
  const { build, change, resolve, stopWatching } = start();
  await build.whenSettled();
  vi.useFakeTimers();
  try {
    change();
    await build.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();

    expect(stopWatching).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
    await build.close();
  }
});

it("keeps the last good build and logs the errors of a failed rebuild", async ({
  onTestFinished,
}) => {
  const { build, resolve, publish, log } = start();
  onTestFinished(() => build.close());
  await build.whenSettled();
  resolve.mockResolvedValue(ready);
  await build.whenSettled();

  publish({ kind: "building" });
  expect(build.state).toEqual({ kind: "built", entry, modules });
  const errors = [{ text: "Unexpected end of file", location: null }];
  publish({ kind: "failed", errors });

  expect(build.state).toEqual({
    kind: "rebuild-failed",
    entry,
    modules,
    errors,
  });
  expect(log).toHaveBeenLastCalledWith(
    `The Page Objects entry ${entry} did not build. The page gets the last good build.\n  Unexpected end of file`
  );

  publish({ kind: "building" });
  const next = [{ text: "Expected identifier", location: null }];
  publish({ kind: "failed", errors: next });
  expect(build.state).toEqual({
    kind: "rebuild-failed",
    entry,
    modules,
    errors: next,
  });
});

it("logs all first-build errors including one with no location", async ({
  onTestFinished,
}) => {
  const file = "/project/ayme/pom/PlainPage.ts";
  const errors = [
    {
      text: "Unexpected end of file",
      location: { file, line: 22, column: 0 },
    },
    { text: "The service was stopped", location: null },
  ];
  const { build, log, resolve } = start(ready, { kind: "failed", errors });
  onTestFinished(() => build.close());

  expect(await build.whenSettled()).toEqual({
    kind: "never-built",
    entry,
    errors,
  });
  expect(resolve).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledExactlyOnceWith(
    `The Page Objects entry ${entry} did not build. No build of it has succeeded, so none is served.\n  ${file}:22:1: Unexpected end of file\n  The service was stopped`
  );
});

it("stops calling a listener once it unsubscribes", async ({
  onTestFinished,
}) => {
  const { build, resolve } = start();
  onTestFinished(() => build.close());
  await build.whenSettled();
  const listener = vi.fn();
  build.subscribe(listener)();

  resolve.mockResolvedValue(ready);
  expect(await build.whenSettled()).toEqual({ kind: "built", entry, modules });
  expect(listener).not.toHaveBeenCalled();
});

it("checks the install again when asked for an answer after the install watcher stopped", async ({
  onTestFinished,
}) => {
  const { build, resolve, fail } = start();
  onTestFinished(() => build.close());
  await build.whenSettled();
  fail();

  resolve.mockResolvedValue(ready);
  expect(await build.whenSettled()).toEqual({ kind: "built", entry, modules });
});

it("ignores the install watcher once the build has started", async ({
  onTestFinished,
}) => {
  const { build, resolve, change, fail, bundle } = start();
  onTestFinished(() => build.close());
  await build.whenSettled();
  resolve.mockResolvedValue(ready);
  change();
  await expect.poll(() => build.state.kind).toBe("built");
  const built = build.state;
  const checks = resolve.mock.calls.length;

  vi.useFakeTimers();
  try {
    // What the watcher reported as the build started.
    change();
    fail();
    await vi.runAllTimersAsync();
  } finally {
    vi.useRealTimers();
  }

  expect(build.state).toBe(built);
  expect(resolve).toHaveBeenCalledTimes(checks);
  expect(bundle).toHaveBeenCalledOnce();
});

it("does not act on an install check the build moved past while it ran", async ({
  onTestFinished,
}) => {
  const { build, resolve, fail } = start();
  onTestFinished(() => build.close());
  await build.whenSettled();
  let check: ((found: Resolution) => void) | undefined;
  resolve.mockImplementationOnce(
    () => new Promise((resolved) => (check = resolved))
  );
  const answer = build.whenSettled();
  await expect.poll(() => check).toBeDefined();

  fail();
  check?.(ready);

  expect(await answer).toEqual({
    kind: "cannot-start",
    entry,
    error: mismatch.error,
  });
});

it("neither watches the install nor starts again once closed during a start", async () => {
  const { build, resolve, change, subscribe } = start();
  await build.whenSettled();
  let check: ((found: Resolution) => void) | undefined;
  resolve.mockImplementationOnce(
    () => new Promise((resolved) => (check = resolved))
  );
  vi.useFakeTimers();
  try {
    change();
    await vi.advanceTimersByTimeAsync(100);
    expect(build.state.kind).toBe("starting");
    // A change during the start asks for another once it ends.
    change();
    await vi.advanceTimersByTimeAsync(100);

    const closing = build.close();
    check?.(mismatch);
    await closing;
  } finally {
    vi.useRealTimers();
  }

  expect(build.state).toEqual({
    kind: "cannot-start",
    entry,
    error: mismatch.error,
  });
  expect(resolve).toHaveBeenCalledTimes(3);
  expect(subscribe).toHaveBeenCalledOnce();
});

it("builds with the compiler of the project's own install", async () => {
  const project = await realpath(await mkdtemp(join(tmpdir(), "ayme-start-")));
  const ayme = join(project, "node_modules", "@ayme-dev", "ayme");
  await mkdir(ayme, { recursive: true });
  await writeFile(
    join(ayme, "package.json"),
    JSON.stringify({
      name: "@ayme-dev/ayme",
      version: "0.2.0",
      type: "module",
      exports: { ".": "./index.js", "./compiler": "./compiler.js" },
    })
  );
  await writeFile(join(ayme, "index.js"), "export const ayme = 1;");
  await writeFile(
    join(ayme, "compiler.js"),
    `export class PomCompileError extends Error {}
export const createPomCompiler = () => ({
  compile: (_file, source) => ({
    code: source + 'export const by = "the project compiler";',
    dependencies: [],
  }),
  invalidate() {},
});`
  );
  await writeFile(join(project, "package.json"), "{}");
  const entry = join(project, "page-objects.ts");
  await writeFile(entry, "export default [];\n");

  const build = startPageObjects(entry, () => {}, "0.2.0");
  try {
    const built = await build.whenSettled();
    assert(built.kind === "built");
    expect(built.modules.get("entry.js")).toContain("the project compiler");
  } finally {
    await build.close();
    await rm(project, { recursive: true, force: true });
  }
});
