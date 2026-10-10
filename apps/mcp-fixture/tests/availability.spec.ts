import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

/** The Basket action that is available only while the basket has items. */
const CLEAR_TOOL = "Basket.clear";

const showBasket = (page: Page) =>
  page.getByRole("button", { name: "Show basket" }).click();
const fillBasket = (page: Page) =>
  page.getByRole("button", { name: "Fill basket" }).click();

/** The listing of `tool` in an `ayme_list_tools` result. */
const listingIn = (text: string, tool: string) =>
  (
    JSON.parse(text) as { name: string; available: boolean; reason?: string }[]
  ).find(({ name }) => name === tool);

test("an unavailable Page Object Tool is listed with its reason, refuses its call, and the note says when it became available", async ({
  agent,
  connect,
  page,
}) => {
  await connect();
  await showBasket(page);
  await expect.poll(() => agent.pageToolNames()).toContain(CLEAR_TOOL);
  await expect
    .poll(async () =>
      listingIn((await agent.call("ayme_list_tools")).text, CLEAR_TOOL)
    )
    .toEqual(
      expect.objectContaining({
        available: false,
        reason: "The basket is empty",
      })
    );

  const refused = await agent.call("ayme_call", { tool: CLEAR_TOOL });
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain(
    `${CLEAR_TOOL} is unavailable: The basket is empty.`
  );

  // Availability changes the listing and the note, not the MCP tool list.
  const changes = agent.toolListChanges();
  await fillBasket(page);
  // The first result after the change carries the note.
  let listed!: Awaited<ReturnType<typeof agent.call>>;
  await expect
    .poll(async () => {
      listed = await agent.call("ayme_list_tools");
      return listingIn(listed.text, CLEAR_TOOL);
    })
    .toEqual(expect.objectContaining({ available: true }));
  expect(listingIn(listed.text, CLEAR_TOOL)).not.toHaveProperty("reason");
  expect(listed.note).toContain(`Became available: ${CLEAR_TOOL}.`);
  expect(agent.toolListChanges()).toBe(changes);

  const cleared = await agent.call(CLEAR_TOOL);
  expect(cleared.isError, cleared.text).toBe(false);
  // Clearing empties the basket, so the call's own result notes the change.
  expect(cleared.note).toContain(
    `Became unavailable: ${CLEAR_TOOL} (The basket is empty).`
  );
});
