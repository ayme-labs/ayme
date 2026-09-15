# Measuring Codex browser interactions

`scripts/measure-codex-interactions.mjs` measures a task turn after a separate
dashboard setup turn.

The setup turn opens the dashboard and waits for the exact
`DASHBOARD_READY` marker. The script then resumes the same Codex task with
the measured task. Only `turn.completed.usage` from the resumed task is
aggregated; setup usage is written to disk but is not included in the summary.

## Requirements

- Node.js 24 or newer and the Codex CLI on `PATH`.
- An authenticated Codex CLI session with the relevant MCP servers configured
  under these names: `webmcp-local-relay`, `playwright`, and
  `computer-use`.
- A running target dashboard. Pass its URL for Playwright and computer-use;
  WebMCP uses the connected local relay page and does not need `--url`.
- For Playwright attachment to an existing Chrome session, configure the
  Playwright MCP server with `--extension` and its extension token. Without
  that option, Playwright MCP starts its own browser context.
- Run from an isolated worktree. The script uses
  `--dangerously-bypass-approvals-and-sandbox` so tool approval overhead does
  not become part of the measurement; only use it in a disposable, trusted
  environment.

The script does not include benchmark results. It writes setup/task JSONL,
metadata, and `summary.json` under the output directory, which is ignored by
Git.

## Example

Run one method at a time with the same task, model, reasoning effort, and
timeout:

```sh
node scripts/measure-codex-interactions.mjs \
  --task "Open Inbox, change the sidebar layout to icon-only, then open Inbox again." \
  --profile webmcp \
  --model gpt-5.3-codex-spark \
  --reasoning high \
  --timeout-ms 90000 \
  --out codex-token-runs/webmcp

node scripts/measure-codex-interactions.mjs \
  --task "Open Inbox, change the sidebar layout to icon-only, then open Inbox again." \
  --profile playwright \
  --url http://localhost:3000/dashboard \
  --model gpt-5.3-codex-spark \
  --reasoning high \
  --timeout-ms 90000 \
  --out codex-token-runs/playwright

node scripts/measure-codex-interactions.mjs \
  --task "Open Inbox, change the sidebar layout to icon-only, then open Inbox again." \
  --profile computer-use \
  --url http://localhost:3000/dashboard \
  --model gpt-5.3-codex-spark \
  --reasoning high \
  --timeout-ms 90000 \
  --out codex-token-runs/computer-use
```

Use the same prompt and model settings across methods. The summary reports
input, cached input, output, reasoning, and total tokens for the measured task
turn.
