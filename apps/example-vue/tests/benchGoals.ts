import { expect, type Page } from "@playwright/test";

/**
 * The bench goal set: goals on the bench pages (`src/bench/`), generic app
 * screens without Page Objects, so the Goal Loop acts only through the
 * Browser Tools and picks each element by ref. Goals are worded as a coding
 * agent words them: mostly one outcome per screen with the Goal Values it
 * needs, a few multi-field goals and one flow across two screens.
 * `goalBench.spec.ts` pursues them with the model; `goalBenchScripted.spec.ts`
 * pursues them with each goal's intended steps as scripted decisions, which
 * shows every goal reachable at its expected step count.
 */

/** One step of a run that goes as intended, as stage one and two answer it. */
export type IntendedStep = {
  operation: string;
  /**
   * The element, as the loop describes its ref options: `role "name"`, or
   * the bare role of an element without a name.
   */
  target?: string;
  /** Which of the elements with that description, in document order; 0 when
   *  omitted. */
  nth?: number;
  /** The Goal Value label chosen for `text`. */
  text?: string;
  /** The Goal Value labels included in a list parameter such as `values`. */
  values?: string[];
};

export type BenchGoal = {
  /** The test title, under which the run harness reports the goal. */
  title: string;
  path: string;
  /** The page's main heading, which shows it rendered. */
  heading: string;
  goal: string;
  values?: Record<string, string>;
  maxSteps: number;
  /** The Handover reason a run that reaches the outcome ends with. */
  reason: "done" | "needs_value" | "unverified" | "no_fitting_option";
  /** A run that goes as intended takes these steps, then, unless it ends
   *  `needs_value`, one more stops it with its reason. Empty when the run
   *  should stop before acting, with an empty history. */
  intended: IntendedStep[];
  /** The page shows the goal's outcome. */
  outcome(page: Page): Promise<void>;
};

const savedField = (page: Page, field: string) =>
  page.getByTestId(`saved-${field}`);
const projectNames = (page: Page) =>
  page.getByRole("list", { name: "Projects" }).getByTestId("project-name");

const profile = {
  "first name": "Grace",
  "last name": "Hopper",
  "display name": "amazing-grace",
  email: "grace@example.com",
  bio: "Rear admiral and compiler pioneer.",
};
const project = {
  "project name": "Atlas",
  description: "Internal tooling for the data team.",
};

export const benchGoals: BenchGoal[] = [
  {
    title: "login: sign in with the given email and password",
    path: "/bench/login",
    heading: "Sign in",
    goal: "Sign in with the given email and password",
    values: { email: "alan@example.com", password: "correct-horse-battery" },
    maxSteps: 10,
    reason: "done",
    intended: [
      { operation: "fill", target: 'textbox "Email"', text: "email" },
      { operation: "fill", target: 'textbox "Password"', text: "password" },
      { operation: "click", target: 'button "Sign in"' },
    ],
    async outcome(page) {
      await expect(page.getByRole("status")).toHaveText(
        "Signed in as alan@example.com"
      );
    },
  },
  {
    title: "login: sign in without the values hands over",
    path: "/bench/login",
    heading: "Sign in",
    goal: "Sign in",
    maxSteps: 3,
    reason: "needs_value",
    intended: [{ operation: "fill" }],
    async outcome(page) {
      await expect(page.getByText(/Signed in as/)).toHaveCount(0);
    },
  },
  {
    title: "profile: set the bio and save",
    path: "/bench/profile",
    heading: "Profile",
    goal: "Set the bio to the given text and save",
    values: { bio: profile.bio },
    maxSteps: 8,
    reason: "done",
    intended: [
      // The editor has no accessible name, so the loop describes it by its
      // role alone.
      { operation: "fill", target: "textbox", text: "bio" },
      { operation: "click", target: 'button "Save"' },
    ],
    async outcome(page) {
      await expect(savedField(page, "bio")).toHaveText(profile.bio);
      await expect(savedField(page, "first-name")).toHaveText("Ada");
    },
  },
  {
    title: "profile: change the display name",
    path: "/bench/profile",
    heading: "Profile",
    goal: "Change the display name to the given value",
    values: { "display name": profile["display name"] },
    maxSteps: 5,
    reason: "done",
    intended: [
      {
        operation: "fill",
        target: 'textbox "Display name"',
        text: "display name",
      },
    ],
    async outcome(page) {
      await expect(page.getByLabel("Display name")).toHaveValue(
        profile["display name"]
      );
      await expect(page.getByLabel("First name")).toHaveValue("Ada");
      await expect(page.getByLabel("Last name")).toHaveValue("Lovelace");
    },
  },
  {
    title: "profile: fill in every field and save",
    path: "/bench/profile",
    heading: "Profile",
    goal: "Fill in the profile with the given values and save",
    values: profile,
    maxSteps: 18,
    reason: "done",
    intended: [
      { operation: "fill", target: 'textbox "First name"', text: "first name" },
      { operation: "fill", target: 'textbox "Last name"', text: "last name" },
      {
        operation: "fill",
        target: 'textbox "Display name"',
        text: "display name",
      },
      { operation: "fill", target: 'textbox "Email"', text: "email" },
      { operation: "fill", target: "textbox", text: "bio" },
      { operation: "click", target: 'button "Save"' },
    ],
    async outcome(page) {
      await expect(savedField(page, "first-name")).toHaveText(
        profile["first name"]
      );
      await expect(savedField(page, "last-name")).toHaveText(
        profile["last name"]
      );
      await expect(savedField(page, "display-name")).toHaveText(
        profile["display name"]
      );
      await expect(savedField(page, "email")).toHaveText(profile.email);
      await expect(savedField(page, "bio")).toHaveText(profile.bio);
    },
  },
  {
    title: "settings: turn on push notifications and save",
    path: "/bench/settings",
    heading: "Settings",
    goal: "Turn on push notifications and save",
    maxSteps: 8,
    reason: "done",
    intended: [
      { operation: "check", target: 'checkbox "Push notifications"' },
      { operation: "click", target: 'button "Save"' },
    ],
    async outcome(page) {
      await expect(savedField(page, "push-notifications")).toHaveText(
        "Push notifications: On"
      );
      await expect(savedField(page, "email-notifications")).toHaveText(
        "Email notifications: On"
      );
    },
  },
  {
    title: "settings: switch to the dark theme",
    path: "/bench/settings",
    heading: "Settings",
    goal: "Switch to the dark theme",
    maxSteps: 5,
    reason: "done",
    intended: [{ operation: "check", target: 'radio "Dark"' }],
    async outcome(page) {
      await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
    },
  },
  {
    // Email notifications are on when the page opens.
    title: "settings: turn on email notifications, already on",
    path: "/bench/settings",
    heading: "Settings",
    goal: "Turn on email notifications",
    maxSteps: 3,
    reason: "done",
    intended: [],
    async outcome(page) {
      await expect(
        page.getByRole("checkbox", { name: "Email notifications" })
      ).toBeChecked();
    },
  },
  {
    title: "settings: set the language",
    path: "/bench/settings",
    heading: "Settings",
    goal: "Set the language to the given language",
    values: { language: "Deutsch" },
    maxSteps: 5,
    reason: "done",
    intended: [
      {
        operation: "select_option",
        target: 'combobox "Language"',
        values: ["language"],
      },
    ],
    async outcome(page) {
      await expect(page.getByLabel("Language")).toHaveValue("Deutsch");
    },
  },
  {
    // The language select offers no Klingon.
    title: "settings: set the language to one it does not offer",
    path: "/bench/settings",
    heading: "Settings",
    goal: "Set the language to Klingon",
    maxSteps: 3,
    reason: "no_fitting_option",
    intended: [],
    async outcome(page) {
      await expect(page.getByLabel("Language")).toHaveValue("English");
    },
  },
  {
    title: "settings: change several settings and save",
    path: "/bench/settings",
    heading: "Settings",
    goal: "Turn off email notifications, use the dark theme, set the language to the given one, and save",
    values: { language: "Español" },
    maxSteps: 12,
    reason: "done",
    intended: [
      { operation: "uncheck", target: 'checkbox "Email notifications"' },
      { operation: "check", target: 'radio "Dark"' },
      {
        operation: "select_option",
        target: 'combobox "Language"',
        values: ["language"],
      },
      { operation: "click", target: 'button "Save"' },
    ],
    async outcome(page) {
      await expect(savedField(page, "email-notifications")).toHaveText(
        "Email notifications: Off"
      );
      await expect(savedField(page, "weekly-summary-email")).toHaveText(
        "Weekly summary email: Off"
      );
      await expect(savedField(page, "theme")).toHaveText("Theme: Dark");
      await expect(savedField(page, "language")).toHaveText(
        "Language: Español"
      );
    },
  },
  {
    title: "projects: filter by the given search",
    path: "/bench/projects",
    heading: "Projects",
    goal: "Show only the projects that match the given search",
    values: { search: "Mobile" },
    maxSteps: 5,
    reason: "done",
    intended: [
      {
        operation: "fill",
        target: 'searchbox "Search projects"',
        text: "search",
      },
    ],
    async outcome(page) {
      await expect(projectNames(page)).toHaveText([
        "Mobile app",
        "Mobile analytics",
      ]);
    },
  },
  {
    title: "projects: rename one project",
    path: "/bench/projects",
    heading: "Projects",
    goal: "Rename the Mobile app project to the given name",
    values: { "new name": "Mobile app v2" },
    maxSteps: 10,
    reason: "done",
    intended: [
      // Every row's button is `button "Rename"`; Mobile app is the second row.
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
  {
    // Issue 536: the goal's end state is a Custom Tool effect outside the
    // page tree (`highlight_page_state_ref`, registered in BenchRoute.vue),
    // so only the step's returned value can show the goal met.
    title: "projects: highlight the rename dialog's Confirm button",
    path: "/bench/projects",
    heading: "Projects",
    goal: "The Confirm button of the Rename project dialog for the Mobile app project is highlighted with highlight_page_state_ref. Open only what is needed to make the Confirm button visible. Do not click, submit or otherwise activate the Confirm button.",
    maxSteps: 4,
    reason: "done",
    intended: [
      { operation: "click", target: 'button "Rename"', nth: 1 },
      { operation: "highlight_page_state_ref", target: 'button "Confirm"' },
    ],
    async outcome(page) {
      const dialog = page.getByRole("dialog");
      await expect(dialog).toHaveCount(1);
      // The dialog of the Mobile app row, not the first row's.
      await expect(dialog.getByLabel("Project name")).toHaveValue("Mobile app");
      await expect(
        page.getByRole("button", { name: "Confirm" })
      ).toHaveAttribute("data-highlighted", "true");
    },
  },
  {
    // Issue 1059: the closed Create button says it is collapsed only through
    // `aria-expanded="false"`, which the page state does not carry (issue
    // 1061), so the page cannot show whether the goal holds and the run
    // should hand back that it could not tell.
    title: "documents: the Create menu is open, while it is closed",
    path: "/bench/documents",
    heading: "Documents",
    goal: "The Create menu is open.",
    maxSteps: 3,
    reason: "unverified",
    intended: [],
    async outcome(page) {
      await expect(page.getByRole("menu")).toHaveCount(0);
    },
  },
  {
    title: "new project: fill in the details and continue",
    path: "/bench/new-project",
    heading: "New project",
    goal: "Fill in the project details with the given values and continue",
    values: project,
    maxSteps: 10,
    reason: "done",
    intended: [
      {
        operation: "fill",
        target: 'textbox "Project name"',
        text: "project name",
      },
      {
        operation: "fill",
        target: 'textbox "Description"',
        text: "description",
      },
      { operation: "click", target: 'button "Continue"' },
    ],
    async outcome(page) {
      await expect(page).toHaveURL(/\/bench\/new-project\/invite$/);
      await expect(
        page.getByRole("heading", { name: "Invite teammates" })
      ).toBeVisible();
      await expect(page.getByText("invite people to Atlas")).toBeVisible();
      await expect(page.getByTestId("draft-description")).toHaveText(
        project.description
      );
    },
  },
  {
    title: "new project: create it and invite a teammate",
    path: "/bench/new-project",
    heading: "New project",
    goal: "Create a project with the given details and invite the given teammate with the given role",
    values: {
      ...project,
      visibility: "Internal",
      "teammate email": "alan@example.com",
      role: "Editor",
    },
    maxSteps: 20,
    reason: "done",
    intended: [
      {
        operation: "fill",
        target: 'textbox "Project name"',
        text: "project name",
      },
      {
        operation: "fill",
        target: 'textbox "Description"',
        text: "description",
      },
      {
        operation: "select_option",
        target: 'combobox "Visibility"',
        values: ["visibility"],
      },
      { operation: "click", target: 'button "Continue"' },
      { operation: "fill", target: 'textbox "Email"', text: "teammate email" },
      {
        operation: "select_option",
        target: 'combobox "Role"',
        values: ["role"],
      },
      { operation: "click", target: 'button "Create project"' },
    ],
    async outcome(page) {
      await expect(page).toHaveURL(/\/bench\/new-project\/invite$/);
      await expect(page.getByTestId("created-name")).toHaveText("Atlas");
      await expect(page.getByTestId("created-description")).toHaveText(
        project.description
      );
      await expect(page.getByTestId("created-visibility")).toHaveText(
        "Internal"
      );
      await expect(page.getByTestId("created-email")).toHaveText(
        "alan@example.com"
      );
      await expect(page.getByTestId("created-role")).toHaveText("Editor");
    },
  },
];

/** The step count of a run that ends `done` as intended, the step judging
 *  the goal met included; none for a goal that should hand over otherwise. */
export function expectedStepsOf(bench: BenchGoal) {
  return bench.reason === "done" ? bench.intended.length + 1 : undefined;
}

/** Per Goal Value label, the element its intended `fill` or `type` targets. */
export function expectedTargetsOf(bench: BenchGoal) {
  const targets: Record<string, string> = {};
  for (const step of bench.intended)
    if (step.text !== undefined && step.target !== undefined)
      targets[step.text] = step.target;
  return Object.keys(targets).length > 0 ? targets : undefined;
}

/** Open the goal's page and wait until it shows its heading. */
export async function openBenchPage(page: Page, bench: BenchGoal) {
  await page.goto(bench.path);
  await expect(
    page.getByRole("heading", { level: 1, name: bench.heading })
  ).toBeVisible();
}
