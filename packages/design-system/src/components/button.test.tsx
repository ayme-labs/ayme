import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("renders the primary variant with the design system's classes", () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).toContain("bg-primary");
    expect(html).toContain('data-slot="button"');
  });

  it("renders the variant, size and class it is given", () => {
    const html = renderToStaticMarkup(
      <Button variant="destructive" size="sm" className="ml-2">
        Delete
      </Button>
    );
    expect(html).toContain("bg-destructive");
    expect(html).toContain("h-8");
    expect(html).toContain("ml-2");
  });

  it("renders its child element instead of a button with asChild", () => {
    const html = renderToStaticMarkup(
      <Button asChild>
        <a href="/docs">Docs</a>
      </Button>
    );
    expect(html).toMatch(/^<a [^>]*href="\/docs"/);
  });
});
