// The scripted flows. Every input is raw CDP input (lib/human.mjs), never a
// Playwright action. Each step names what a person would say they did.
import { sleep } from "./pw.mjs";

const PACE = 1200; // lets the recorder's 500 ms double-click wait and the settle rule pass

export const flows = {
  fixture: {
    url: (origin) => origin + "/",
    async run({ page, human, step }) {
      const frame = page.frameLocator("#frame");
      await step("click Other", () => human.clickOn(page.locator("#other")));
      await step(
        "click Load orders (a row arrives 1.5 s later)",
        () => human.clickOn(page.locator("#load")),
        2600
      );
      await step("click Other again (the late row is on the page by now)", () =>
        human.clickOn(page.locator("#other"))
      );
      await step(
        "click Insert task (a lookalike row is inserted by the click)",
        () => human.clickOn(page.locator("#insertNow"))
      );
      await step(
        "click Insert task later (a lookalike row arrives 1.5 s later)",
        () => human.clickOn(page.locator("#insertLater")),
        2600
      );
      await step(
        "click Notify later (a toast appears on its own 1.5 s later)",
        () => human.clickOn(page.locator("#notify")),
        2600
      );
      await step(
        "click Dismiss in the toast (the click removes the toast)",
        () => human.clickOn(page.locator("#dismiss"))
      );
      await step("click the Name field", () =>
        human.clickOn(page.locator("#name"))
      );
      await step("type Ada", () => human.type("Ada"));
      await step("press Enter (submits the form)", () => human.key("Enter"));
      await step("click the Subscribe checkbox", () =>
        human.clickOn(page.locator("#subscribe"))
      );
      await step("choose green in the native select", async () => {
        await page.locator("#color").focus();
        await human.key("g");
      });
      await step("click Menu (the menu opens on pointerdown)", () =>
        human.clickOn(page.locator("#menuBtn"))
      );
      await step("click Rename in the menu", () =>
        human.clickOn(page.locator("#rename"))
      );
      await step("click the cart (the target is not in the tree)", () =>
        human.clickOn(page.locator(".cart"))
      );
      await step("click the button in the open shadow root", () =>
        human.clickOn(page.locator("#shadowBtn"))
      );
      await step("click the button in the iframe", () =>
        human.clickOn(frame.locator("#inner"))
      );
      await step("press Tab in the iframe", () => human.key("Tab"));
    },
  },

  saucedemo: {
    url: () => "https://www.saucedemo.com/",
    onlyHost: "saucedemo.com",
    async run({ page, human, step }) {
      await step("click Username", () =>
        human.clickOn(page.locator('[data-test="username"]'))
      );
      await step("type standard_user", () =>
        human.type("standard_user", { delay: 30 })
      );
      await step("click Password", () =>
        human.clickOn(page.locator('[data-test="password"]'))
      );
      await step("type secret_sauce", () =>
        human.type("secret_sauce", { delay: 30 })
      );
      await step(
        "click Login",
        () => human.clickOn(page.locator('[data-test="login-button"]')),
        2500
      );
      await step("click Add to cart (Backpack)", () =>
        human.clickOn(
          page.locator('[data-test="add-to-cart-sauce-labs-backpack"]')
        )
      );
      await step(
        "click the cart link",
        () => human.clickOn(page.locator('[data-test="shopping-cart-link"]')),
        2500
      );
    },
  },
};

// The flow the package check records: log in, add an item, open the cart,
// remove the item.
flows["saucedemo-cart"] = {
  url: flows.saucedemo.url,
  onlyHost: "saucedemo.com",
  async run(io) {
    await flows.saucedemo.run(io);
    await io.step("click Remove (Backpack) in the cart", () =>
      io.human.clickOn(
        io.page.locator('[data-test="remove-sauce-labs-backpack"]')
      )
    );
  },
};

// The reported case: SauceDemo's cart link used to be a bare <a> with no role,
// name or text, so it was not in the tree. The site has since given it
// role="button" and an aria-label. This flow takes those two attributes off
// again before the click, to show what is recorded for a target not in the tree.
flows["saucedemo-bare-cart-link"] = {
  url: flows.saucedemo.url,
  onlyHost: "saucedemo.com",
  async run({ page, human, step }) {
    await step("click Username", () =>
      human.clickOn(page.locator('[data-test="username"]'))
    );
    await step("type standard_user", () =>
      human.type("standard_user", { delay: 30 })
    );
    await step("click Password", () =>
      human.clickOn(page.locator('[data-test="password"]'))
    );
    await step("type secret_sauce", () =>
      human.type("secret_sauce", { delay: 30 })
    );
    await step(
      "click Login",
      () => human.clickOn(page.locator('[data-test="login-button"]')),
      2500
    );
    await step("click Add to cart (Backpack)", () =>
      human.clickOn(
        page.locator('[data-test="add-to-cart-sauce-labs-backpack"]')
      )
    );
    await page.locator('[data-test="shopping-cart-link"]').evaluate((el) => {
      el.removeAttribute("role");
      el.removeAttribute("aria-label");
    });
    await step(
      "click the cart link (role and aria-label removed first)",
      () => human.clickOn(page.locator('[data-test="shopping-cart-link"]')),
      2500
    );
  },
};

// Late data that lands while the focus is already in a text field: the one case
// where typing's "before" matters, since typing is never gated.
flows["late-typing"] = {
  url: (origin) => origin + "/",
  async run({ page, human, step }) {
    await step(
      "click Load orders (a row arrives 1.5 s later)",
      () => human.clickOn(page.locator("#load")),
      700
    );
    await step(
      "click the Name field (before the row arrives)",
      () => human.clickOn(page.locator("#name")),
      2200
    );
    await step("type Ada (the late row is on the page by now)", () =>
      human.type("Ada")
    );
  },
};

/** Runs `fn` as one human step and waits for the page and the recorder to catch up. */
export function stepper(log = () => {}) {
  const steps = [];
  const step = async (name, fn, wait = PACE) => {
    log(`  step: ${name}`);
    steps.push(name);
    try {
      await fn();
    } catch (error) {
      steps[steps.length - 1] = `${name}  !! ${String(error).split("\n")[0]}`;
      log(`    !! ${String(error).split("\n")[0]}`);
    }
    await sleep(wait);
  };
  return { step, steps };
}
