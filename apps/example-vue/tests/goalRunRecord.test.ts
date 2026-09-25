// @vitest-environment node
import type { Page, TestInfo } from "@playwright/test";
import { expect, it, vi } from "vitest";

import { goalRunsVariable } from "../scripts/appEnvironment";
import { recordGoalRun } from "./goalRunRecord";

it("passes the run straight through unless the run harness asks for a record", async () => {
  vi.stubEnv(goalRunsVariable, undefined);
  const page = { on: vi.fn(), evaluate: vi.fn() };
  const testInfo = { attach: vi.fn() };
  const handover = { reason: "done" };

  await expect(
    recordGoalRun(
      page as unknown as Page,
      testInfo as unknown as TestInfo,
      "a goal",
      async () => handover
    )
  ).resolves.toBe(handover);
  for (const spy of [page.on, page.evaluate, testInfo.attach])
    expect(spy).not.toHaveBeenCalled();
});
