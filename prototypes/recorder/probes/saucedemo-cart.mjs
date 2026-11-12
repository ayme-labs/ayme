// Reproduces the owner's report: on SauceDemo the cart link is clicked, but it
// is not in the tree. Shows the element, the public snapshot around it and
// what Playwright's recorder says about the click.
// usage: node probes/saucedemo-cart.mjs [version]
import { loadPlaywright, startRecorder, sleep } from "../lib/pw.mjs";
import { createHuman } from "../lib/human.mjs";

const { pw, version } = loadPlaywright(process.argv[2]);
const browser = await pw.chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1100, height: 900 },
});
await context.route("**/*", (route) =>
  new URL(route.request().url()).hostname.endsWith("saucedemo.com")
    ? route.continue()
    : route.abort()
);
const page = await context.newPage();
await page.goto("https://www.saucedemo.com/");
// log in with Playwright here: this probe is about the cart link only
await page.locator('[data-test="username"]').fill("standard_user");
await page.locator('[data-test="password"]').fill("secret_sauce");
await page.locator('[data-test="login-button"]').click();
await page.waitForURL("**/inventory.html");
const events = [];
await startRecorder(context, (e) => events.push(e));
await sleep(500);
const human = await createHuman(context, page);
const out = { version };
const cart = page.locator('[data-test="shopping-cart-link"]');
const aroundCart = (yaml) =>
  yaml.split("\n").filter((line) => /Cart|Swag Labs/.test(line));
const lastClick = () => {
  const click = events.filter((e) => e.action.name === "click").at(-1);
  return {
    selector: click.action.selector,
    ref: click.action.ref ?? null,
    code: click.code.trim(),
  };
};

// 1. empty cart
out["1. empty cart: link element"] = await cart.evaluate((el) => el.outerHTML);
out["1. empty cart: public snapshot lines"] = aroundCart(
  await page.ariaSnapshot({ mode: "ai" })
);

// 2. the owner's flow: add an item, then click the cart link
await human.clickOn(
  page.locator('[data-test="add-to-cart-sauce-labs-backpack"]')
);
await sleep(1200);
out["2. one item: link element"] = await cart.evaluate((el) => el.outerHTML);
out["2. one item: public snapshot lines"] = aroundCart(
  await page.ariaSnapshot({ mode: "ai" })
);
out["2. one item: locator(badge).ariaSnapshot({mode:'ai'})"] = await page
  .locator('[data-test="shopping-cart-badge"]')
  .ariaSnapshot({ mode: "ai" });
out["2. element under the centre of the link"] = await cart.evaluate((el) => {
  const box = el.getBoundingClientRect();
  const hit = document.elementFromPoint(
    box.x + box.width / 2,
    box.y + box.height / 2
  );
  return hit.outerHTML.slice(0, 90);
});
await human.clickOn(cart);
await sleep(1500);
out["2. click at the centre of the link: recorder action"] = lastClick();
out["2. url after"] = page.url();

// 3. back, and click the badge itself
await page.goto("https://www.saucedemo.com/inventory.html");
await sleep(800);
await human.clickOn(page.locator('[data-test="shopping-cart-badge"]'));
await sleep(1500);
out["3. click on the badge: recorder action"] = lastClick();
out["3. event snapshot lines"] = aroundCart(
  events.filter((e) => e.action.name === "click").at(-1).action.ariaSnapshot
);
out["3. url after"] = page.url();
console.log(JSON.stringify(out, null, 1));
await browser.close();
