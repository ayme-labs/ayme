import { describe, expect, it, vi } from "vitest";
import type { ScreenObject } from "../page-objects/domain";
import { ACTION_RESULT_NOTE } from "../page-state/domain";
import type { ToolInfo } from "../shared";
import {
  publishedInfo,
  webMcpToolSource,
  type WebMcpSession,
} from "./webMcpTools";

const screen = (name: string): ScreenObject[] => [
  {
    className: "SurveyEditorPage",
    children: [
      {
        kind: "elements",
        name: "surveyName",
        lines: [`textbox "Survey name": ${name}`],
      },
    ],
  },
];

const rootedTool: ToolInfo = {
  name: "QuestionCard.remove",
  className: "QuestionCard",
  agentDescription: "Remove this question.",
  inputSchema: {
    type: "object",
    properties: {
      ref: {
        type: "string",
        description:
          "Structural Ref of the instance's Page Object Root, as marked in the page state.",
      },
    },
    required: ["ref"],
  },
  group: "pageObject",
  available: true,
};

const clickTool: ToolInfo = {
  name: "click",
  agentDescription: `Click an element. ${ACTION_RESULT_NOTE}`,
  inputSchema: { type: "object" },
  group: "browser",
  available: true,
};

function session(overrides: Partial<Omit<WebMcpSession, "run">> = {}) {
  const screens = [screen("Draft"), screen("Final")];
  let url = "http://app/edit";
  return {
    list: () => [rootedTool, clickTool],
    subscribe: () => () => {},
    run: vi.fn(async (): Promise<unknown> => ({
      settled: true,
      page_changed: true,
      changes_before: "- e2 status: Saved",
      changes: '- e5 textbox "Survey name": Final',
      result: { saved: true },
    })),
    readScreen: vi.fn(async () => screens.shift() ?? screen("Final")),
    url: () => url,
    moveTo: (next: string) => {
      url = next;
    },
    ...overrides,
  };
}

describe("the session's tools as WebMCP publishes them", () => {
  it("publishes the Page Object Tools and page_objects alone, asking a rooted tool for a po ref", () => {
    const tools = webMcpToolSource(session()).list();
    expect(tools.map(({ name }) => name)).toEqual([
      "QuestionCard.remove",
      "page_objects",
    ]);
    expect(
      (
        tools[0]!.inputSchema as {
          properties: { ref: { description: string } };
        }
      ).properties.ref.description
    ).toBe("The instance's ref, po<n>, as page_objects shows it.");
  });

  it("drops the Change Record sentence from a published description", () => {
    expect(publishedInfo(clickTool).description).toBe("Click an element.");
  });

  it("answers page_objects with the Page Object Screen as text", async () => {
    const tools = webMcpToolSource(session());
    expect(await tools.run("page_objects", {})).toEqual({
      content: [
        {
          type: "text",
          text: 'SurveyEditorPage\n  surveyName: textbox "Survey name": Draft',
        },
      ],
    });
  });

  it("answers an action with how the Page Object Screen changed, and no structural Change Record", async () => {
    const tools = webMcpToolSource(session());
    expect(await tools.run("SurveyEditorPage.setSurveyName", {})).toEqual({
      settled: true,
      result: { saved: true },
      changes:
        'SurveyEditorPage\n  surveyName: textbox "Survey name": Draft → Final',
    });
  });

  it("adds the URL only when the action changed it, and leaves changes out when the screen did not change", async () => {
    const source = session({ readScreen: async () => screen("Draft") });
    source.run.mockImplementationOnce(async () => {
      source.moveTo("http://app/summary");
      return { settled: true, page_changed: true };
    });
    const tools = webMcpToolSource(source);
    expect(await tools.run("SurveyEditorPage.saveAndClose", {})).toEqual({
      settled: true,
      url: "http://app/summary",
    });
    source.run.mockResolvedValueOnce({ settled: false, page_changed: false });
    expect(await tools.run("SurveyEditorPage.saveAndClose", {})).toEqual({
      settled: false,
    });
  });

  it("answers a full load with loading alone, without next or reading the gone screen", async () => {
    const source = session();
    source.run.mockResolvedValueOnce({
      settled: false,
      page_changed: false,
      loading: "http://app/next",
      next: "Read the page again.",
    } as never);
    const tools = webMcpToolSource(source);
    expect(await tools.run("click", {})).toEqual({
      settled: false,
      loading: "http://app/next",
    });
    expect(source.readScreen).toHaveBeenCalledOnce();
  });

  it("passes a result that is not an action's through", async () => {
    const source = session();
    source.run.mockResolvedValueOnce({ structure: "- main" } as never);
    expect(await webMcpToolSource(source).run("snapshot", {})).toEqual({
      structure: "- main",
    });
  });
});
