import type { Arm } from "./arms.ts";
import type { Mission } from "./missions.ts";

/**
 * The prompt every arm gets. Only `arm.interfaceLine` differs between arms.
 * It never carries the mission's credentials: the browser is signed in before
 * the agent's first turn.
 */
export function createPrompt(mission: Mission, arm: Arm, baseUrl: string) {
  return `Complete the following task in the Formbricks application running at ${baseUrl}.

${arm.interfaceLine}
Do not use any other browser interface, and do not change anything through the terminal, the Formbricks API or its database.

A browser is already signed in and open on the survey editor at:
${mission.startUrl}

1. Change the survey's name to: ${mission.expected.surveyName}
2. Change the headline of its question to: ${mission.expected.questionHeadline}
3. Save and close the survey.
4. Confirm that the survey summary page at ${mission.summaryUrl} shows the new name.

After every browser interaction, check the resulting page state and confirm that the expected effect occurred before continuing. Investigate and recover when it did not. If the browser interface itself fails to start or reports an environment error, stop and report the exact tool and error instead of working around it.

The working directory holds the Formbricks source for reference. Treat it as read-only: make every change through the running application, and do not start, stop or reconfigure the application.

Finish only after the summary page shows the new survey name. Report the final URL and the evidence that convinced you the task succeeded.
`;
}
