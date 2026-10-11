import { expect, it } from "vitest";

import { pageWelcome } from "./welcome";

it("names the token, the image folder and the agent when there are some", () => {
  expect(
    pageWelcome({
      token: "t0k3n",
      imageFolder: "/tmp/ayme/",
      agent: "claude-code",
    })
  ).toStrictEqual({
    token: "t0k3n",
    imageFolder: "/tmp/ayme/",
    agent: "claude-code",
  });
});

it("leaves out each one there is none of", () => {
  expect(
    pageWelcome({ token: undefined, imageFolder: undefined, agent: undefined })
  ).toStrictEqual({});
});

it("leaves out an agent that gave an empty name, which the welcome refuses", () => {
  expect(
    pageWelcome({ token: undefined, imageFolder: undefined, agent: "" })
  ).toStrictEqual({});
});
