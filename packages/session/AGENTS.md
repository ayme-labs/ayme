# Session package

The Session of the `ayme` command: one running ayme connected to one browser, in a background process that the commands of its project folder talk to. It is private; [the CLI](../cli/src/session.ts) bundles it. Why a Session exists: [ADR-0069](../../docs/adr/0069-a-projects-page-objects-run-in-node-in-a-session-beside-the-developers-browser-automation.md). The rules a Session keeps are the numbered rules of the spec, issue [#1484](https://github.com/ayme-labs/ayme/issues/1484) "The ayme command runs a project's Page Objects in Node, beside the developer's browser automation".

The slices of `src/`, from the bottom up, each in `domain`, `application` and `infrastructure` layers:

- `session`: the Session itself. `domain` holds what a Caller asks and what it is answered, with the answers' sentences ([`answers.ts`](src/session/domain/answers.ts)); `application` holds the Session ([`session.ts`](src/session/application/session.ts)) and its one seam, the browser it gets ([`sessionBrowser.ts`](src/session/application/sessionBrowser.ts)).
- `playwright`: that seam on [`@ayme-dev/browser`](../browser/AGENTS.md). Its `infrastructure/live/` drives a real browser; the plain logic beside it, such as the start errors' sentences, is tested without one ([docs/testing.md](../../docs/testing.md#code-a-real-browser-runs)).
- `process`: the background process and the commands' side of it: the claims of a folder's Session in the user's cache folder, the local socket, and starting the process.
- `src/index.ts` is the front door, for the CLI.
- `testing/`, beside `src/`: a real Session on a scripted browser ([ADR-0057](../../docs/adr/0057-test-support-lives-beside-src-and-is-never-published.md)).

The checks: [`eslint.config.js`](eslint.config.js), which [`src/layout.test.ts`](src/layout.test.ts) checks.

Nothing checks these:

- Hand the CLI only promises and plain data from `src/index.ts`, so the CLI, which lint keeps free of Effect, needs no Effect types.
- Let the CLI only print the sentences this package answers with, so each wording has one place: the Session's answers in its `domain` ([`answers.ts`](src/session/domain/answers.ts)), and why a start failed beside the code that finds it, in the `playwright` and `process` slices.
- Answer every request: one that cannot be carried out is answered `ok: false` with why, since a command must never wait for an answer that cannot come (rule 1).
- The command's end-to-end fixture reads the `pid` of the folder's newest record (`sessionProcess` in [`aymeCommand.ts`](../../apps/mcp-fixture/tests/aymeCommand.ts)): change both together.
- Flows are written with Effect 4; [the recorder's notes](../recorder/AGENTS.md#effect) say which documentation to use.

## Adding to a Session

- A command: a member of `SessionRequest` ([`requests.ts`](src/session/domain/requests.ts)), its answer in `ask`, and its word in the CLI's [`readCommand.ts`](../cli/src/readCommand.ts). The process carries any request through unchanged, and the CLI prints every answer through [`answer.ts`](../cli/src/answer.ts).
- Something the browser does or tells: a member of `SessionBrowser`, carried out by the stock adapter and the scripted browser alike.
- A rule: in the Session, with a test through its interface on the scripted browser.

## Testing

How to run tests here, and what each lane measures: [docs/testing.md](../../docs/testing.md#local-runs-and-ci).

- [`src/session.test.ts`](src/session.test.ts) tests the Session through its interface on the scripted browser, `startScriptedSession` from `testing/`: the orderings of a Session's rules, which are slow and unreliable to make happen in a real browser.
- [`process.test.ts`](src/process/infrastructure/process.test.ts) serves a Session on the scripted browser in the test's own process and reaches it as a command does.
- Keep the functions under `infrastructure/live/` short: no test this package's CRAP score counts runs them ([docs/testing.md](../../docs/testing.md#code-a-real-browser-runs)).
