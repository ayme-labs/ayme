import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createServer, type ViteDevServer } from "vite";
import { afterEach, expect, it, vi } from "vitest";

import { ayme } from "./vite";

const decoratorStub = `export const ayme = Object.assign(
  (value: unknown, context: ClassDecoratorContext) => {},
  { action: (options: { description: string }) =>
      (value: unknown, context: ClassMethodDecoratorContext) => {} }
);
`;

function baseSource(description: string) {
  return `import { ayme } from "./ayme";

export class BasePom {
  @ayme.action({ description: "${description}" })
  status() {}
}
`;
}

let root: string | undefined;
let server: ViteDevServer | undefined;

afterEach(async () => {
  await server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  server = undefined;
  root = undefined;
});

function writeProject() {
  const projectRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "ayme-vite-dev-"))
  );
  mkdirSync(join(projectRoot, "src"));
  writeFileSync(
    join(projectRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
      },
      include: ["src"],
    })
  );
  writeFileSync(join(projectRoot, "src/ayme.ts"), decoratorStub);
  writeFileSync(join(projectRoot, "src/base.ts"), baseSource("ORIGINAL"));
  writeFileSync(
    join(projectRoot, "src/sub.ts"),
    `import { BasePom } from "./base";
import { ayme } from "./ayme";

@ayme
export class SubPom extends BasePom {}
`
  );
  writeFileSync(
    join(projectRoot, "src/main.ts"),
    `import "./base";\nimport "./sub";\n`
  );
  // Stand-ins for the runtime imports the compiled modules reference.
  writeFileSync(
    join(projectRoot, "src/internalStub.ts"),
    "export function registerCompiledPom(..._args: unknown[]) {}\n"
  );
  writeFileSync(
    join(projectRoot, "src/decorateStub.ts"),
    "export default function decorate(..._args: unknown[]) {}\n"
  );
  return projectRoot;
}

it("recompiles a decorated subclass after its base class file changes", async () => {
  root = writeProject();
  const projectRoot = root;
  server = await createServer({
    root: projectRoot,
    configFile: false,
    logLevel: "silent",
    plugins: [ayme()],
    resolve: {
      alias: {
        "@ayme-dev/ayme/internal": join(projectRoot, "src/internalStub.ts"),
        "@oxc-project/runtime/helpers/decorate": join(
          projectRoot,
          "src/decorateStub.ts"
        ),
      },
    },
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    // A custom browser environment besides client, e.g. a worker graph.
    environments: { worker: { consumer: "client" } },
  });
  const environments = [
    server.environments.client,
    server.environments.worker!,
  ] as const;
  const baseFile = join(projectRoot, "src/base.ts");
  const subDescriptions = () =>
    Promise.all(
      environments.map(
        async (environment) =>
          (await environment.transformRequest("/src/sub.ts"))?.code.match(
            /"description":\s*"(\w+)"/
          )?.[1]
      )
    );
  const editBase = async (description: string) => {
    const changed = new Promise<void>((resolve) => {
      const onChange = (file: string) => {
        if (file !== baseFile) return;
        server?.watcher.off("change", onChange);
        resolve();
      };
      server?.watcher.on("change", onChange);
    });
    writeFileSync(baseFile, baseSource(description));
    await changed;
    // Let Vite finish the invalidation and HMR hooks for the change.
    await new Promise((resolve) => setTimeout(resolve, 100));
  };

  for (const environment of environments) {
    await environment.transformRequest("/src/main.ts");
    await environment.transformRequest("/src/base.ts");
  }
  expect(await subDescriptions()).toEqual(["ORIGINAL", "ORIGINAL"]);

  await editBase("CHANGED");
  expect(await subDescriptions()).toEqual(["CHANGED", "CHANGED"]);

  await editBase("CHANGEDAGAIN");
  expect(await subDescriptions()).toEqual(["CHANGEDAGAIN", "CHANGEDAGAIN"]);
  // Starts a Vite dev server and compiles the subclass three times: 1.3 s
  // locally, 7.6 to 13.5 s on CI beside the other Turbo tasks.
}, 30_000);

it("recompiles a Page Object after a type-only import outside the Vite root changes", async () => {
  // Nuxt-like layout: Vite's root is app/, the Page Objects live beside it.
  const projectRoot = realpathSync(
    mkdtempSync(join(tmpdir(), "ayme-vite-outside-root-"))
  );
  root = projectRoot;
  mkdirSync(join(projectRoot, "app"));
  mkdirSync(join(projectRoot, "pom"));
  writeFileSync(
    join(projectRoot, "pom/tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        experimentalDecorators: false,
      },
      include: ["."],
    })
  );
  writeFileSync(join(projectRoot, "pom/ayme.ts"), decoratorStub);
  const modeFile = join(projectRoot, "pom/CounterMode.ts");
  const writeMode = (values: string) =>
    writeFileSync(modeFile, `export type CounterMode = ${values};\n`);
  writeMode(`"up" | "down"`);
  const pomFile = join(projectRoot, "pom/CounterPage.ts");
  writeFileSync(
    pomFile,
    `import { ayme } from "./ayme";
import type { CounterMode } from "./CounterMode";

@ayme
export class CounterPage {
  @ayme.action({ description: "Step the counter." })
  step(mode: CounterMode) {}
}
`
  );
  writeFileSync(
    join(projectRoot, "app/internalStub.ts"),
    "export function registerCompiledPom(..._args: unknown[]) {}\n"
  );
  writeFileSync(
    join(projectRoot, "app/decorateStub.ts"),
    "export default function decorate(..._args: unknown[]) {}\n"
  );
  server = await createServer({
    root: join(projectRoot, "app"),
    configFile: false,
    logLevel: "silent",
    plugins: [ayme()],
    resolve: {
      alias: {
        "@ayme-dev/ayme/internal": join(projectRoot, "app/internalStub.ts"),
        "@oxc-project/runtime/helpers/decorate": join(
          projectRoot,
          "app/decorateStub.ts"
        ),
      },
    },
    server: { middlewareMode: true, ws: false, fs: { strict: false } },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const environment = server.environments.client;
  const modeValues = async () =>
    (await environment.transformRequest(`/@fs${pomFile}`))?.code.match(
      /"enum":\s*(\[[^\]]*\])/
    )?.[1];
  const normalize = (json: string | undefined) =>
    JSON.stringify(JSON.parse(json ?? "null"));

  expect(normalize(await modeValues())).toBe(`["up","down"]`);

  // `addWatchFile` hands the file to chokidar, which starts watching it
  // asynchronously; an edit before that raises no change event.
  const watchedNames = () =>
    server?.watcher.getWatched()[dirname(modeFile)] ?? [];
  await vi.waitFor(() => expect(watchedNames()).toContain("CounterMode.ts"), {
    timeout: 10_000,
  });

  const changed = new Promise<void>((resolve) => {
    const onChange = (file: string) => {
      if (file !== modeFile) return;
      server?.watcher.off("change", onChange);
      resolve();
    };
    server?.watcher.on("change", onChange);
  });
  writeMode(`"up" | "down" | "reset"`);
  await changed;

  await vi.waitFor(
    async () =>
      expect(normalize(await modeValues())).toBe(`["up","down","reset"]`),
    { timeout: 10_000 }
  );
}, 30_000);
