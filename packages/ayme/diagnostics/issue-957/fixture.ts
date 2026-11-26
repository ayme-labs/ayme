// Investigation fixture. Only post-input work changes between fast/slow cases.
import type { Page } from "@playwright/test";
import { createPage as createLitePage } from "@ayme-dev/playwright-lite";
import { createAyme } from "../../src/runtime/runtime";
import { createPage } from "../../src/page-objects/infrastructure";
import { registerCompiledPom } from "../../src/page-objects/application";
import { errorText } from "../../src/shared";

type Case = {
  workMs: number;
  path: "browser" | "pom" | "lite" | "host";
  scheduling?: "sync" | "microtask" | "timer";
  timeoutMs?: number;
};
type Driver = {
  tools: { name: string; execute(input: unknown): Promise<unknown> }[];
};
declare global {
  interface Window {
    configure957: (options: Case) => void;
    read957: () => unknown;
    afterWork957: () => Promise<void>;
    diagnose957: (options: Case) => Promise<unknown>;
  }
}

let marks: Record<string, number>;
let clicks: number;
let workDone: Promise<void>;
window.configure957 = ({ workMs, scheduling = "sync" }) => {
  document.body.innerHTML =
    '<button id="apply">Apply</button><p id="effect">Pending</p>';
  marks = {};
  clicks = 0;
  let finished: () => void;
  workDone = new Promise((resolve) => {
    finished = resolve;
  });
  const work = () => {
    marks.workStarted = performance.now();
    while (performance.now() - marks.workStarted < workMs) {
      /* deliberate long task */
    }
    marks.workReturned = performance.now();
    finished();
  };
  document.querySelector("#apply")!.addEventListener("click", () => {
    marks.clickEntered = performance.now();
    document.querySelector("#effect")!.textContent = `Applied ${++clicks}`;
    marks.effect = performance.now();
    if (scheduling === "sync") work();
    else if (scheduling === "microtask") queueMicrotask(work);
    else setTimeout(work, 0);
    marks.handlerReturned = performance.now();
  });
};
window.read957 = () => ({
  clicks,
  effect: document.querySelector("#effect")!.textContent,
  timeOrigin: performance.timeOrigin,
  marks,
});
window.afterWork957 = () => workDone;

class DiagnosticPage {
  constructor(readonly page: Page) {}
  apply() {
    return this.page.locator("#apply").click();
  }
}
registerCompiledPom(DiagnosticPage, {
  className: "DiagnosticPage",
  members: [],
  components: [],
  tools: [
    { methodName: "apply", toolName: "DiagnosticPage.apply", parameters: [] },
  ],
});

window.diagnose957 = async (options) => {
  window.configure957(options);
  const page =
    options.path === "lite"
      ? createLitePage({ actionTimeout: 1000 })
      : createPage();
  const ayme =
    options.path === "lite"
      ? undefined
      : createAyme({ pageFactory: () => page, webMCP: { enabled: true } });
  if (options.path === "pom") ayme?.pom.register(DiagnosticPage);
  const stop = ayme?.start();
  const call = (name: string, input: unknown) => {
    const tool = (document.modelContext as unknown as Driver).tools.find(
      (tool) => tool.name === name
    );
    if (!tool) throw new Error(`Missing published tool ${name}`);
    return tool.execute(input);
  };
  try {
    let ref: string | undefined;
    if (ayme) {
      await ayme.webMCP.retryPublication();
      if (ayme.webMCP.publicationStatus.state !== "active")
        throw new Error(JSON.stringify(ayme.webMCP.publicationStatus));
      const snapshot = (await call("snapshot", {})) as { structure: string };
      ref = snapshot.structure.match(/(e\d+) button "Apply"/)?.[1];
      if (!ref)
        throw new Error("Snapshot did not expose Apply's Structural Ref");
    }
    marks.started = performance.now();
    let result: unknown;
    let error: string | undefined;
    let stack: string | undefined;
    try {
      if (options.path === "lite") await page.locator("#apply").click();
      else
        result = await call(
          options.path === "pom" ? "DiagnosticPage.apply" : "click",
          options.path === "pom" ? {} : { target: ref }
        );
    } catch (caught) {
      error = errorText(caught);
      stack = (caught as Error).stack;
    }
    marks.returned = performance.now();
    // Observe deferred work after recording the action's actual completion time.
    if (options.scheduling === "timer") await workDone;
    return {
      ...options,
      ...(window.read957() as object),
      result,
      error,
      stack,
    };
  } finally {
    stop?.();
  }
};
