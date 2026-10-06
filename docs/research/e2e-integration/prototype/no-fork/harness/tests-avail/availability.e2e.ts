import { expect, test } from "e2e";
import { aymeAvailability } from "../../src/index.ts";
import { COUNTER_POM_FILE, engine, POM_FILE } from "../base.config.ts";

/** The live-tool filter follows the counter's root: live while mounted, gone after "Unmount counter", back after "Mount counter". */
test("offers the counter tool only while the counter is on the page", async ({
  app,
  screen,
}) => {
  await app.open("/");
  const live = aymeAvailability({
    engine,
    files: [POM_FILE, COUNTER_POM_FILE],
  });
  expect([...(await live())].sort()).toEqual([
    "CounterPage_increment",
    "ProjectsPage_createProject",
  ]);
  await screen.getByRole("button", "Unmount counter").tap();
  await expect(screen.getByRole("button", "Mount counter")).toBeVisible();
  expect([...(await live())].sort()).toEqual(["ProjectsPage_createProject"]);
  await screen.getByRole("button", "Mount counter").tap();
  await expect(screen.getByRole("button", "Unmount counter")).toBeVisible();
  expect([...(await live())].sort()).toEqual([
    "CounterPage_increment",
    "ProjectsPage_createProject",
  ]);
});
