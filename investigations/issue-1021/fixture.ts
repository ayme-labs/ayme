// Investigation only. No production patches, network services, or Inspector.
import { createPage } from "../../packages/ayme/src/page-objects/infrastructure/browserPage";
import {
  registerCompiledPom,
  probeRegisteredPomMembers,
  listRegisteredPomRoots,
  listRegisteredPomTargets,
  listRegisteredPoms,
} from "../../packages/ayme/src/page-objects/infrastructure/registry";
import { RootedComponent } from "../../packages/ayme/src/test-utils/pomRoot.testSupport";
import { startSession } from "../../packages/ayme/src/test-utils/session.testSupport";
import { resolveLocatorElements } from "../../packages/ayme/node_modules/@ayme-dev/playwright-lite/dist/internal.mjs";
import type { Locator } from "@playwright/test";

export const html = (rows: number, buttons = true) =>
  `<h1>Projects</h1><ul aria-label="Projects">${Array.from({ length: rows }, (_, i) => `<li id="row-${i}">${buttons ? `<button>Project ${i}</button>` : `Project ${i}`}</li>`).join("")}</ul>`;
export const collection = (page: any, kind: string) =>
  kind === "role"
    ? page.getByRole("list", { name: "Projects" }).locator(":scope > li")
    : page.locator('ul[aria-label="Projects"] > li');

// Same probe is installed in Playwright's utility world for the differential.
// Counts returned native querySelectorAll candidates, not unique DOM nodes.
export function domProbe() {
  const stats: Record<string, { calls: number; candidates: number }> = {};
  const restores: (() => void)[] = [];
  for (const proto of [Document.prototype, Element.prototype]) {
    const original = proto.querySelectorAll;
    proto.querySelectorAll = function (selector: string) {
      const result = original.call(this, selector);
      const key = `${this instanceof Document ? "document" : this.tagName}:${selector}`;
      const entry = (stats[key] ??= { calls: 0, candidates: 0 });
      entry.calls++;
      entry.candidates += result.length;
      return result;
    } as typeof original;
    restores.push(() => (proto.querySelectorAll = original));
  }
  return { stats, stop: () => restores.forEach((restore) => restore()) };
}

function instrument(page: any) {
  const probe = domProbe();
  const resolutions: Record<string, number> = {};
  const driverCalls: Record<string, number> = {};
  const restores: (() => void)[] = [];
  let operation = "directResolve";
  function wrap(
    owner: any,
    key: string,
    around: (original: Function, receiver: any, args: any[]) => any
  ) {
    const original = owner[key];
    owner[key] = function (...args: any[]) {
      return around(original, this, args);
    };
    restores.push(() => (owner[key] = original));
  }
  const proto = Object.getPrototypeOf(page.locator("body"));
  for (const method of ["all", "count", "isVisible"])
    wrap(proto, method, (original, receiver, args) => {
      const previous = operation;
      operation = method;
      driverCalls[method] = (driverCalls[method] ?? 0) + 1;
      try {
        return original.apply(receiver, args);
      } finally {
        operation = previous;
      }
    });
  for (const method of ["resolveAll", "resolveLocatorElement"])
    wrap(page, method, (original, receiver, args) => {
      const selector = String(args[0]).replace(/nth=\d+/g, "nth=*");
      const key = `${operation}:${selector}`;
      resolutions[key] = (resolutions[key] ?? 0) + 1;
      return original.apply(receiver, args);
    });
  return {
    probe,
    resolutions,
    driverCalls,
    stop() {
      restores.reverse().forEach((restore) => restore());
      probe.stop();
    },
  };
}

export async function runCase(options: {
  rows: number;
  kind?: string;
  members?: boolean;
  actions?: boolean;
  registered?: boolean;
  uniqueRoots?: boolean;
  operation?: string;
  mutate?: boolean;
  lightRoots?: boolean;
  instrumented?: boolean;
  plainRows?: boolean;
}) {
  const {
    rows,
    kind = "role",
    members = true,
    actions = true,
    registered = true,
    uniqueRoots = false,
    operation = "probe",
    mutate = false,
    lightRoots = false,
    instrumented = true,
    plainRows = false,
  } = options;
  document.body.innerHTML = html(rows, !plainRows);
  const page = createPage();
  let reads = 0;
  class ProjectRow extends RootedComponent {
    readonly button: Locator = this.root.getByRole("button");
    moveUp() {}
    moveDown() {}
    archive() {}
  }
  class ProjectsPage {
    async items() {
      reads++;
      return (await collection(page, kind).all()).map(
        (root: Locator, i: number) =>
          new ProjectRow(
            lightRoots
              ? page.locator(`css:light=#row-${i}`)
              : uniqueRoots
                ? page.locator(`#row-${i}`)
                : root
          )
      );
    }
  }
  registerCompiledPom(ProjectsPage, {
    className: "ProjectsPage",
    tools: [],
    members: [
      {
        memberName: "items",
        kind: "component",
        access: "method",
        componentClassName: "ProjectRow",
        collection: true,
      },
    ],
    components: [
      {
        className: "ProjectRow",
        members: members
          ? [{ memberName: "button", kind: "locator", access: "field" }]
          : [],
        tools: actions
          ? ["moveUp", "moveDown", "archive"].map((methodName) => ({
              methodName,
              toolName: `ProjectRow.${methodName}`,
              description: methodName,
              parameters: [],
              returnPoms: [],
            }))
          : [],
      },
    ],
  });
  const session = startSession(page);
  let measured: ReturnType<typeof instrument> | undefined;
  try {
    if (registered) session.register(ProjectsPage);
    await probeRegisteredPomMembers();
    const rootsBefore = (await listRegisteredPomRoots()).length;
    if (rootsBefore !== (registered ? rows : 0))
      throw new Error(`Wrong roots ${rootsBefore}`);
    // Give the agent a baseline before measuring its next call.
    if (operation === "hover")
      await session.ayme.tools.run("snapshot", {}, { by: "ayme-mcp" });
    reads = 0;
    if (instrumented) measured = instrument(page);
    if ((globalThis as any).startDiagnosticProfile)
      await (globalThis as any).startDiagnosticProfile();
    const start = performance.now();
    if (mutate) document.querySelector("li")?.remove();
    if (operation === "snapshot")
      await session.ayme.tools.run("snapshot", {}, { by: "ayme-mcp" });
    else if (operation === "hover")
      await session.ayme.tools.run(
        "hover",
        { target: "h1" },
        { by: "ayme-mcp" }
      );
    else if (operation === "targets") await listRegisteredPomTargets();
    else await probeRegisteredPomMembers();
    const ms = +(performance.now() - start).toFixed(2);
    const dom = measured?.probe.stats ?? {};
    const result = {
      ...options,
      ms,
      observations: reads,
      resolutions: measured?.resolutions ?? {},
      locatorCalls: measured?.driverCalls ?? {},
      qsaCalls: Object.values(dom).reduce((n, e) => n + e.calls, 0),
      candidates: Object.values(dom).reduce((n, e) => n + e.candidates, 0),
      dom,
      observedRows: registered
        ? listRegisteredPoms()[0]?.memberObservations.find(
            (m) => m.kind === "component-collection"
          )?.count
        : 0,
    };
    measured?.stop();
    measured = undefined;
    const observedRoots = registered
      ? (listRegisteredPoms()[0] as any).instances
          .filter((instance: any) => instance.root?.element)
          .map((instance: any) => instance.root.element.id)
      : [];
    const expectedRoots = registered
      ? Array.from({ length: rows }, (_, i) => `row-${i}`).slice(mutate ? 1 : 0)
      : [];
    if (JSON.stringify(observedRoots) !== JSON.stringify(expectedRoots))
      throw new Error("Observation lost or reused stale roots");
    return result;
  } finally {
    measured?.stop();
    session.stop();
    document.body.innerHTML = "";
  }
}

// Replays exactly the root/member resolution sequence used in one registry
// observation. The real registry cases above establish these call counts.
export async function liteSequence(rows: number, kind: string) {
  document.body.innerHTML = html(rows);
  const page = createPage();
  const probe = domProbe();
  const start = performance.now();
  try {
    const locators = await collection(page, kind).all();
    for (const root of locators) {
      await root.count();
      resolveLocatorElements(root);
      await root.isVisible();
      resolveLocatorElements(root);
      const button = root.getByRole("button");
      resolveLocatorElements(button);
      await button.count();
    }
    return {
      rows,
      kind,
      ms: +(performance.now() - start).toFixed(2),
      dom: probe.stats,
    };
  } finally {
    probe.stop();
    document.body.innerHTML = "";
  }
}
