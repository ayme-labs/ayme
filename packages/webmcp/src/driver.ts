import type {} from "@mcp-b/webmcp-types";

/** The part of `document.modelContext` publication uses. */
export type WebMcpDriver = Pick<
  NonNullable<typeof document.modelContext>,
  "registerTool"
>;

/**
 * The page's WebMCP driver, `document.modelContext`, once it appears within
 * `timeoutMs`; `undefined` when it does not or `signal` aborts first.
 */
export function waitForWebMcpDriver(timeoutMs: number, signal: AbortSignal) {
  const deadline = Date.now() + timeoutMs;

  return new Promise<WebMcpDriver | undefined>((resolve) => {
    let timer: number | undefined;
    const finish = (driver: WebMcpDriver | undefined) => {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(driver);
    };
    const abort = () => finish(undefined);
    const check = () => {
      if (document.modelContext) {
        finish(document.modelContext);
        return;
      }
      if (Date.now() >= deadline) {
        finish(undefined);
        return;
      }
      timer = setTimeout(check, 50);
    };
    if (signal.aborted) finish(undefined);
    else {
      signal.addEventListener("abort", abort, { once: true });
      check();
    }
  });
}
