import { expect } from "@playwright/test";

import type { BenchGoal } from "./benchGoals";

const projectNames = (page: Parameters<BenchGoal["outcome"]>[0]) =>
  page.getByRole("list", { name: "Projects" }).getByTestId("project-name");

/**
 * Goals for issue 536 ("Goal Loop hands over done before running the
 * operation it chose"), on the projects bench page:
 *
 * 1. The issue's case: the goal's end state is a Custom Tool effect outside
 *    the page tree (`highlight_page_state_ref`, registered in BenchRoute.vue).
 *    The loop must open the rename dialog, then highlight its Confirm button.
 * 2. The later observation: the end state is in the page tree (the renamed
 *    project), but the goal is worded as an end state, not as a task.
 */
export const repro536Goals: BenchGoal[] = [
  {
    title: "repro 536: highlight the rename dialog's Confirm button",
    path: "/bench/projects",
    heading: "Projects",
    goal: "The Confirm button of the Rename project dialog for the Mobile app project is highlighted with highlight_page_state_ref. Open only what is needed to make the Confirm button visible. Do not click, submit or otherwise activate the Confirm button.",
    maxSteps: 4,
    reason: "done",
    intended: [
      // Every row's button is `button "Rename"`; Mobile app is the second row.
      { operation: "click", target: 'button "Rename"', nth: 1 },
      { operation: "highlight_page_state_ref", target: 'button "Confirm"' },
    ],
    async outcome(page) {
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Confirm" })
      ).toHaveAttribute("data-highlighted", "true");
    },
  },
  {
    title: "repro 536: the Mobile app project is renamed (end-state wording)",
    path: "/bench/projects",
    heading: "Projects",
    goal: "The Mobile app project is renamed to the given name",
    values: { "new name": "Mobile app v2" },
    maxSteps: 8,
    reason: "done",
    intended: [
      { operation: "click", target: 'button "Rename"', nth: 1 },
      {
        operation: "fill",
        target: 'textbox "Project name"',
        text: "new name",
      },
      { operation: "click", target: 'button "Confirm"' },
    ],
    async outcome(page) {
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(projectNames(page)).toHaveText([
        "Website redesign",
        "Mobile app v2",
        "Marketing site",
        "Mobile analytics",
        "Billing migration",
      ]);
    },
  },
];
