# Browser setup

Set the project up for the `ayme` command as
[Connect an agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md)
describes. Diagnose with the "The agent cannot reach the page" section of
[Troubleshooting](https://github.com/ayme-labs/ayme/blob/main/docs/guide/troubleshooting.md#the-agent-cannot-reach-the-page).
To start a Session beside your browser automation, read
[Browser automation tools](browser-automation-tools.md).

- The project needs `@ayme-dev/cli`, and `@ayme-dev/ayme` at exactly the same
  version. `npm ls @ayme-dev/cli @ayme-dev/ayme` prints both. When they
  differ, or one is missing, ask the user before you install or change a
  package.
- The project needs Playwright, `@playwright/test` or `playwright`, at a
  version the command supports. A Session runs the Page Objects on the
  project's own Playwright. `ayme open` also needs Chromium for it:
  `npx playwright install chromium`.
- `ayme/page-objects.ts` lists the Page Objects a Session runs: its default
  export is an array of the project's Page Object classes, as the app's
  `pageObjects` option takes them. A class that no listed class reaches has
  no tools. In an app that ships ayme, list the same classes as the app
  registers.
- The page needs nothing of ayme. A Session runs the Page Objects in Node, on
  any page, whether its app ships ayme or not.
- When a Session does not start, the command says why, such as a missing
  package, a Playwright version it does not support, or the build error of
  the Page Objects. Fix that, then start it again.
- Check the setup end to end: run one of the project's Page Object Tools
  with `ayme call` and confirm its visible effect with your browser
  automation.
