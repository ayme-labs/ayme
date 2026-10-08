import { afterEach, expect, it } from "vitest";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";

import { agentCursor } from "./agentCalls.testSupport";
import { getInteractionHistory, lookAtPageStateForDocument } from "./pageState";
import { refsIn, startAgentSession } from "./lookAtPageState.testSupport";

let stop = () => {};
afterEach(() => {
  stop();
  document.body.innerHTML = "";
});

async function agent() {
  const session = await startAgentSession();
  stop = session.stop;
  return session;
}

function refOf(structure: string, name: string) {
  const ref = structure.match(new RegExp(`(e\\d+) button "${name}"`))?.[1];
  if (!ref) throw new Error(`Expected a ref for the "${name}" button.`);
  return AriaRefSchema.parse(ref);
}

it("lets the agent's ref reach an identical replacement even when a look saw the gap", async () => {
  document.body.innerHTML = `<main><button id="old">Save</button></main>`;
  const { call, read } = await agent();
  const save = refOf(await read(), "Save");
  document.querySelector("#old")!.remove();

  await lookAtPageStateForDocument(document);
  document
    .querySelector("main")!
    .insertAdjacentHTML("beforeend", `<button id="new">Save</button>`);
  let clicked = false;
  document.querySelector("#new")!.addEventListener("click", () => {
    clicked = true;
  });
  await call("click", { target: save });

  expect(clicked).toBe(true);
});

it("gives each element the ref the agent's next read shows it with", async () => {
  document.body.innerHTML = `<main><button>Act</button></main>`;
  const { read } = await agent();
  await read();
  document
    .querySelector("main")!
    .insertAdjacentHTML(
      "beforeend",
      `<button>One</button><input aria-label="Title" />`
    );

  const look = await lookAtPageStateForDocument(document);
  const next = await read();

  expect(refsIn(look.text)).toEqual(refsIn(next));
  // Diagnostic: the comparison covers the elements added since the last read.
  expect(refsIn(next).join("\n")).toMatch(/button One[\s\S]*textbox Title/);
});

it("adds nothing to the interaction history", async () => {
  document.body.innerHTML = `<main><button>Act</button></main>`;
  const { read } = await agent();
  await read();
  const history = getInteractionHistory(document);
  const latest = history.latestObservation;
  const agentPage = agentCursor().current();
  document.body.insertAdjacentHTML("beforeend", `<p>Changed</p>`);

  await lookAtPageStateForDocument(document);

  expect(history.latestObservation).toBe(latest);
  expect(agentCursor().current()).toBe(agentPage);
});
