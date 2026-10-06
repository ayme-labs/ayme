import type { Arm } from "./arms.ts";
import { missionDefinitions, type Mission } from "./missions.ts";

/**
 * The first message of every run, the same for every arm: it names no app
 * and no task, and keeps the agent off the page. Starting up and loading the
 * arm's skill happen in this turn, outside the measured one.
 */
export const setupPrompt = `Get ready to work in the web page that is already open in your browser interface; the task follows in the next message. If a skill for your browser interface is in your skill list, load it. Otherwise don't look for one. Don't read files and don't use the browser; just reply ready.
`;

/** Where the browser is when the task arrives, as the task tells the agent. */
function startLine(start: Mission["start"]) {
  switch (start.screen) {
    case "editor":
      return "A browser is already signed in and open on the survey editor at:";
    case "sign-in":
      return "A browser is open on the sign-in page, not signed in, at:";
  }
}

/**
 * The task, sent as the second message. Only `arm.interfaceLine` differs
 * between arms; the start, the steps and the finish come from the mission.
 * The credentials are in it only for a mission that starts signed out.
 */
export function createPrompt(mission: Mission, arm: Arm, baseUrl: string) {
  const definition = missionDefinitions[mission.id];
  if (definition === undefined)
    throw new Error(`Unknown mission ${mission.id}`);
  const steps = definition
    .steps(mission)
    .map((step, index) => `${index + 1}. ${step}`)
    .join("\n");
  return `Complete the following task in the Formbricks application running at ${baseUrl}.

${arm.interfaceLine(mission.start)}
Do not use any other browser interface, and do not change anything through the terminal, the Formbricks API or its database.

${startLine(mission.start)}
${mission.start.url}

${steps}

After every browser interaction, check the resulting page state and confirm that the expected effect occurred before continuing. Investigate and recover when it did not. If the browser interface itself fails to start or reports an environment error, stop and report the exact tool and error instead of working around it.

The working directory holds the Formbricks source for reference. Treat it as read-only: make every change through the running application, and do not start, stop or reconfigure the application.

Finish only after ${definition.finish}. Report the final URL and the evidence that convinced you the task succeeded.
`;
}
