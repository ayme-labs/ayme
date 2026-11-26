import { expect, it } from "vitest";

import { answerReport } from "./answer";

it("prints an answer's text on stdout, and exits with 0", () => {
  expect(answerReport({ ok: true, text: "Done." }, false)).toEqual({
    stream: "stdout",
    text: "Done.\n",
    exitCode: 0,
  });
});

it("prints a failure's text on stderr, and exits with 1", () => {
  expect(answerReport({ ok: false, text: "No Session." }, false)).toEqual({
    stream: "stderr",
    text: "No Session.\n",
    exitCode: 1,
  });
});

it("prints the answer as one line of JSON for --json, on the same stream and with the same code", () => {
  expect(
    answerReport(
      { ok: true, text: "Opened.", data: { address: "http://127.0.0.1:9222" } },
      true
    )
  ).toEqual({
    stream: "stdout",
    text: '{"ok":true,"text":"Opened.","data":{"address":"http://127.0.0.1:9222"}}\n',
    exitCode: 0,
  });
  expect(answerReport({ ok: false, text: "No Session." }, true)).toEqual({
    stream: "stderr",
    text: '{"ok":false,"text":"No Session."}\n',
    exitCode: 1,
  });
});
