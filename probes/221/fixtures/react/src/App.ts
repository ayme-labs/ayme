import * as React from "react";
import { AymeProvider, useAyme, usePageObject } from "@ayme-dev/react";
import { CounterPage } from "./CounterPage";

const h = React.createElement;

function Counter() {
  const [count, setCount] = React.useState(0);
  const pom: CounterPage = usePageObject(CounterPage);
  return h(
    "section",
    { "aria-label": "Counter" },
    h("p", null, "Count: ", h("output", null, String(count))),
    h("button", { onClick: () => setCount((v) => v + 1) }, "Increment"),
    h("button", { onClick: () => void pom.increment() }, "Call Page Object")
  );
}

function App() {
  const { webMCP } = useAyme();
  const [visible, setVisible] = React.useState(true);
  return h(
    "main",
    null,
    h(
      "p",
      { role: "status", "aria-label": "Publication" },
      `Publication: ${webMCP.publicationStatus.state}`
    ),
    h(
      "button",
      { onClick: () => void webMCP.retryPublication() },
      "Retry publication"
    ),
    h(
      "button",
      { onClick: () => setVisible((v) => !v) },
      visible ? "Unmount counter" : "Mount counter"
    ),
    visible ? h(Counter) : null
  );
}

export function Root() {
  return h(
    React.StrictMode,
    null,
    h(AymeProvider, { webMCP: { enabled: true } }, h(App))
  );
}
