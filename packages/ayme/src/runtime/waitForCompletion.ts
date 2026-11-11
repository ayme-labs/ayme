// Playwright's wait after a tool's action, adapted from `waitForCompletion`
// in its tool layer (packages/playwright-core/src/tools/backend/utils.ts,
// Copyright (c) Microsoft Corporation, Apache License 2.0). The branch that
// waits for the load of a navigation request is left out: a document sees no
// navigation request of its own, and a full page load ends it.

/** A request the page started, as Playwright and Playwright Lite report it. */
export type CompletionRequest = {
  resourceType(): string;
  response(): Promise<{ finished(): Promise<unknown> } | null>;
};

/** What the wait needs of the page: Playwright's API, which Playwright Lite supplies in the document. */
export type CompletionPage = {
  on(event: "request", listener: (request: CompletionRequest) => void): unknown;
  off(
    event: "request",
    listener: (request: CompletionRequest) => void
  ): unknown;
  waitForTimeout(timeout: number): Promise<void>;
};

export const COMPLETION_SETTLE_MS = 500;
export const COMPLETION_REQUESTS_DEADLINE_MS = 5_000;

/** The resource types whose response Playwright waits to finish; of the others it waits for the response alone. */
const FINISHED_RESOURCE_TYPES = [
  "document",
  "stylesheet",
  "script",
  "xhr",
  "fetch",
];

/**
 * Runs `callback` and waits as Playwright's tools do after an action: it
 * records every request the page starts while `callback` runs and for
 * `COMPLETION_SETTLE_MS` after, waits until each has finished, for at most
 * `COMPLETION_REQUESTS_DEADLINE_MS`, and, when it recorded any, waits
 * `COMPLETION_SETTLE_MS` more. A result `ended` says ended the document is
 * returned at once.
 */
export async function waitForCompletion<R>(
  page: CompletionPage,
  callback: () => Promise<R>,
  ended: (result: R) => boolean = () => false
): Promise<R> {
  const requests: CompletionRequest[] = [];
  const requestListener = (request: CompletionRequest) =>
    requests.push(request);
  page.on("request", requestListener);

  let result: R;
  try {
    result = await callback();
    if (ended(result)) return result;
    await page.waitForTimeout(COMPLETION_SETTLE_MS);
  } finally {
    page.off("request", requestListener);
  }

  const promises = requests.map((request) =>
    FINISHED_RESOURCE_TYPES.includes(request.resourceType())
      ? request
          .response()
          .then((response) => response?.finished())
          .catch(() => {})
      : request.response().catch(() => {})
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, COMPLETION_REQUESTS_DEADLINE_MS);
  });
  await Promise.race([Promise.all(promises), timeout]);
  clearTimeout(timer);
  if (requests.length) await page.waitForTimeout(COMPLETION_SETTLE_MS);

  return result;
}
