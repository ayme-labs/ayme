import type { AymeOptions } from "@ayme-dev/ayme";

import { SignInPage } from "./pom/SignInPage";
import { SurveyNavigationPage } from "./pom/SurveyNavigationPage";
import { SurveyEditorPage, SurveySummaryPage } from "./pom/SurveyPages";

/**
 * The Page Objects a Session runs on the Formbricks lab app, which does not
 * ship ayme. Each page is present on its own path, so the page offers
 * only the current screen's Page Object Tools.
 */
export default [
  SignInPage,
  SurveyNavigationPage,
  SurveyEditorPage,
  SurveySummaryPage,
] satisfies AymeOptions["pageObjects"];
