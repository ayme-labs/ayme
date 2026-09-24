import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, type ViteDevServer } from "vite";
import { afterEach, expect, it } from "vitest";

import { aymeWebMcp } from "./vite";

const decoratorStub = `export const WebMCP = Object.assign(
  (value: unknown, context: ClassDecoratorContext) => {},
  { tool: (options: { description: string }) =>
      (value: unknown, context: ClassMethodDecoratorContext) => {} }
);
`;

function baseSource(description: string) {
  return `import { WebMCP } from "./webmcp";

export class BasePom {
  @WebMCP.tool({ description: "${description}" })
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
  writeFileSync(join(projectRoot, "src/webmcp.ts"), decoratorStub);
  writeFileSync(join(projectRoot, "src/base.ts"), baseSource("ORIGINAL"));
  writeFileSync(
    join(projectRoot, "src/sub.ts"),
    `import { BasePom } from "./base";
import { WebMCP } from "./webmcp";

@WebMCP
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
    plugins: [aymeWebMcp()],
    resolve: {
      alias: {
        "@ayme-dev/webmcp/internal": join(projectRoot, "src/internalStub.ts"),
        "@oxc-project/runtime/helpers/decorate": join(
          projectRoot,
          "src/decorateStub.ts"
        ),
      },
    },
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const environment = server.environments.client;
  const baseFile = join(projectRoot, "src/base.ts");
  const subDescription = async () =>
    (await environment.transformRequest("/src/sub.ts"))?.code.match(
      /"description":\s*"(\w+)"/
    )?.[1];
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

  await environment.transformRequest("/src/main.ts");
  await environment.transformRequest("/src/base.ts");
  expect(await subDescription()).toBe("ORIGINAL");

  await editBase("CHANGED");
  expect(await subDescription()).toBe("CHANGED");

  await editBase("CHANGEDAGAIN");
  expect(await subDescription()).toBe("CHANGEDAGAIN");
});
