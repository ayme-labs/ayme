import { afterEach, describe, expect, it } from "vitest";
import type { Ayme } from "./index";

type AymeWindow = Window & { ayme?: Ayme };

// A page of its own that starts Ayme from this package's source, so a
// reload of it is a cross-document navigation with a fresh runtime.
const PAGE = `
  <main><button>Save</button></main>
  <script type="module">
    import { createAyme, createPage } from "/src/index.ts";
    const ayme = createAyme({ pageFactory: () => createPage() });
    ayme.start();
    window.ayme = ayme;
  </script>
`;

describe("The Run log across a cross-document navigation, in Chromium", () => {
  let frame: HTMLIFrameElement;

  afterEach(() => frame.remove());

  /** The Ayme the frame's current document started. */
  async function aymeOf(previous?: Ayme): Promise<Ayme> {
    let ayme: Ayme | undefined;
    // The first load transforms the package's source, which takes a while.
    await expect
      .poll(
        () => {
          ayme = (frame.contentWindow as AymeWindow | null)?.ayme;
          return ayme !== undefined && ayme !== previous;
        },
        { timeout: 20_000 }
      )
      .toBe(true);
    return ayme!;
  }

  it("starts a new, empty Run log", { timeout: 45_000 }, async () => {
    frame = document.createElement("iframe");
    frame.srcdoc = PAGE;
    document.body.append(frame);
    const before = await aymeOf();
    await before.tools.run("click", {
      target: "role=button[name='Save']",
    });
    expect(before.runs.list()).toHaveLength(1);

    frame.contentWindow!.location.reload();
    const after = await aymeOf(before);

    expect(after.runs.list()).toEqual([]);
  });
});
