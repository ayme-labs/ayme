import type { AymeOptions } from "@ayme-dev/ayme";

import { SignInPage } from "./pom/SignInPage";
import { SurveyEditorPage } from "./pom/SurveyEditorPage";
import { SurveyNavigationPage } from "./pom/SurveyNavigationPage";
import { SurveySummaryPage } from "./pom/SurveySummaryPage";

/**
 * The Page Objects `ayme mcp` serves to the Formbricks lab app, which does
 * not ship Ayme. Each page is present on its own path, so the page offers
 * only the current screen's Page Object Tools.
 */
export default [
  SignInPage,
  SurveyNavigationPage,
  SurveyEditorPage,
  SurveySummaryPage,
] satisfies AymeOptions["pageObjects"];
