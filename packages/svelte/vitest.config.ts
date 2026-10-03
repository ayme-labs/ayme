import { compile, VERSION } from "svelte/compiler";
import { defineConfig, type Plugin } from "vitest/config";

const legacyCompiler = Number(VERSION.split(".")[0]) < 5;

/**
 * Compiles the test components with the installed Svelte, so the same tests
 * run on Svelte 3, 4 and 5. Svelte 5 keeps the Svelte 4 component API
 * (`new Component`, `$destroy`, `Component.render`) for them.
 */
function svelteTestComponents(target: "client" | "server"): Plugin {
  return {
    name: "svelte-test-components",
    transform(source, id) {
      if (!id.endsWith(".svelte")) return;
      const { js } = compile(source, {
        filename: id,
        ...(legacyCompiler
          ? { generate: target === "client" ? "dom" : "ssr" }
          : { generate: target, compatibility: { componentApi: 4 } }),
      } as Parameters<typeof compile>[1]);
      return { code: js.code, map: js.map };
    },
  };
}

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [svelteTestComponents("client")],
        resolve: { conditions: ["browser"] },
        test: {
          name: "browser",
          environment: "jsdom",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.ssr.test.ts"],
        },
      },
      {
        plugins: [svelteTestComponents("server")],
        test: {
          name: "server",
          environment: "node",
          include: ["src/**/*.ssr.test.ts"],
        },
      },
    ],
  },
});
