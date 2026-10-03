import { defineComponent, h, ref } from "vue";
import { AymeProvider, useAyme, usePageObject } from "@ayme-dev/vue";
import { CounterPage } from "./CounterPage";

const Counter = defineComponent({
  setup() {
    const count = ref(0);
    const pom: CounterPage = usePageObject(CounterPage);
    return () =>
      h("section", { "aria-label": "Counter" }, [
        h("p", null, ["Count: ", h("output", null, String(count.value))]),
        h("button", { onClick: () => count.value++ }, "Increment"),
        h(
          "button",
          { onClick: () => void pom.increment() },
          "Call Page Object"
        ),
      ]);
  },
});

const App = defineComponent({
  setup() {
    const { webMCP } = useAyme();
    const visible = ref(true);
    return () =>
      h("main", null, [
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
          { onClick: () => (visible.value = !visible.value) },
          visible.value ? "Unmount counter" : "Mount counter"
        ),
        visible.value ? h(Counter) : null,
      ]);
  },
});

export const Root = defineComponent({
  setup() {
    return () =>
      h(AymeProvider, { webMCP: { enabled: true } }, { default: () => h(App) });
  },
});
