import React from "react";
import { createRoot } from "react-dom/client";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { createAyme, createPage } from "@ayme-dev/ayme";
import { SurveyList } from "./SurveyList";

const params = new URLSearchParams(location.search);
const events: object[] = [];
const record = (kind: string, detail: object = {}) =>
  events.push({ t: performance.now(), kind, ...detail });
const label = (element: EventTarget | null) =>
  element instanceof Element
    ? (element.getAttribute("data-testid") ??
      element.getAttribute("role") ??
      element.tagName)
    : null;
const state = () => ({
  trigger: document
    .querySelector('[data-testid="change-status"]')
    ?.getAttribute("data-state"),
  itemPresent: !!document.querySelector(
    '[data-testid="survey-status-option-completed"]'
  ),
  status: document.querySelector("output")?.textContent,
  subSide: document
    .querySelector('[data-testid="survey-status-option-completed"]')
    ?.closest('[role="menu"]')
    ?.getAttribute("data-side"),
});
const diagnostic = {
  events,
  record,
  state,
  runtime: undefined as any,
  direct: undefined as any,
};
(window as any).diagnostic = diagnostic;
for (const kind of [
  "pointerover",
  "pointerout",
  "pointermove",
  "pointerdown",
  "pointerup",
  "click",
]) {
  document.addEventListener(
    kind,
    (event) => {
      const pointer = event as PointerEvent;
      record(kind, {
        target: label(event.target),
        related: label(pointer.relatedTarget),
        x: pointer.clientX,
        y: pointer.clientY,
        pointerType: pointer.pointerType,
        trusted: event.isTrusted,
        ...state(),
      });
    },
    true
  );
}
new MutationObserver((mutations) => {
  if (
    mutations.some(
      (m) => m.attributeName === "data-state" || m.type === "childList"
    )
  )
    record("dom", state());
}).observe(document.body, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["data-state"],
});

document.head.insertAdjacentHTML(
  "beforeend",
  `<style>
body { margin: 32px; font: 14px Arial; }
.survey-row { display: flex; align-items: center; justify-content: space-between; width: 480px; height: 48px; border-bottom: 1px solid #ccc; }
[data-side] { overflow-x: ${params.get("overflow") === "visible" ? "visible" : "hidden"}; overflow-y: ${params.get("overflow") === "visible" ? "visible" : "auto"}; max-height: 320px; }
[role=menu] { min-width: 180px; padding: 5px; background: white; border: 1px solid #777; border-radius: 4px; box-shadow: 0 4px 12px #0002; }
[role^=menuitem] { padding: 9px 12px; outline: none; cursor: default; }
[role^=menuitem][data-highlighted] { background: #ddd; }
</style>`
);

function App() {
  const [status, setStatus] = React.useState("inProgress");
  const [openRow, setOpenRow] = React.useState<number | null>(null);
  return (
    <>
      <h1>Survey list</h1>
      <output>{status}</output>
      {Array.from({ length: Number(params.get("rows") ?? 7) }, (_, i) => (
        <div
          className="survey-row relative block"
          key={i}
          style={{ width: Number(params.get("rowWidth") ?? 480) }}
        >
          <a href={`#survey-${i}`}>Survey {i}</a>
          <Menu.Root
            open={openRow === i}
            onOpenChange={(open) => setOpenRow(open ? i : null)}
          >
            <Menu.Trigger data-testid="survey-dropdown-trigger">
              Open options
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content sideOffset={4}>
                <Menu.Item>Edit</Menu.Item>
                <Menu.Item>Rename</Menu.Item>
                <Menu.Item>Duplicate</Menu.Item>
                <Menu.Sub>
                  <Menu.SubTrigger data-testid="change-status">
                    Change status
                  </Menu.SubTrigger>
                  <Menu.SubContent sideOffset={Number(params.get("gap") ?? 8)}>
                    <Menu.RadioGroup
                      value={status}
                      onValueChange={(value) => {
                        record("selected", { value });
                        setOpenRow(null);
                        setStatus(value);
                      }}
                    >
                      {["inProgress", "paused", "completed"].map((value) => (
                        <Menu.RadioItem
                          key={value}
                          value={value}
                          data-testid={`survey-status-option-${value}`}
                          onSelect={(event) => event.preventDefault()}
                        >
                          <span>{value}</span>
                        </Menu.RadioItem>
                      ))}
                    </Menu.RadioGroup>
                  </Menu.SubContent>
                </Menu.Sub>
                <Menu.Item>Archive</Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
      ))}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
const runtime = createAyme({
  agentConnection: true,
  webMCP: { enabled: false },
  inspector: false,
});
runtime.pom.register(SurveyList);
runtime.start();
diagnostic.runtime = runtime;
const raw = new SurveyList(createPage());
diagnostic.direct = (mode: "hover" | "click") => raw.setCompleted(mode);
