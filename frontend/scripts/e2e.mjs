// Drives the built app in a real browser against GenLayer Studio, as two
// people: a buyer and a seller, each with their own Studio burner.
//
//   buyer funds a two-clause deal  ->  seller delivers 2 cities (spec: 3)
//   buyer disputes "cities"        ->  anyone convenes the jury
//   the jury's verdict is shown    ->  phone layout has no sideways scroll
//
// Usage: node scripts/e2e.mjs [baseUrl]
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:4173";
const WORK = "https://raw.githubusercontent.com/Ritapossible/Clause/main/examples/cities-two.json";
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } } : {}),
});
const errors = [];
async function person() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?net=studio#/app`);
  await page.getByRole("button", { name: "Studio burner" }).click();
  await page.getByRole("button", { name: "Forget" }).waitFor({ timeout: 90000 });
  const address = await page.evaluate(() => {
    const { createAccount } = window;
    return localStorage.getItem("clause.studio-burner.v1");
  });
  return { ctx, page, key: address };
}

console.log("[site]");
const buyer = await person();
check("buyer burner created and funded", !!buyer.key);
await buyer.page.goto(`${BASE}/?net=studio#/`);
check("product page", (await buyer.page.locator("main").innerText()).includes("Escrow that pays on the spec you wrote"));
await buyer.page.goto(`${BASE}/?net=studio#/how`);
check("how-it-works page", (await buyer.page.locator("main").innerText()).includes("does the delivered work fail this"));

const seller = await person();
await seller.page.goto(`${BASE}/?net=studio#/app`);
const sellerAddr = (await seller.page.locator(".burner-row button[title*='click to copy']").first().getAttribute("title")).split(" ")[0];
check("seller burner created", /^0x[0-9a-fA-F]{40}$/.test(sellerAddr), sellerAddr);

console.log("\n[flow] the buyer funds a deal");
await buyer.page.goto(`${BASE}/?net=studio#/app/new`);
await buyer.page.getByPlaceholder("0x…").fill(sellerAddr);
await buyer.page.getByText("The spec can be funded").waitFor({ timeout: 10000 });
check("the example spec passes the in-browser checks", true);
const tests = buyer.page.getByPlaceholder("The response contains exactly 3 city names");
await tests.first().fill("Do good work");
check("a taste test is refused before signing", (await buyer.page.locator("main").innerText()).includes("relies on taste"));
await tests.first().fill("The response contains exactly 3 city names");
await buyer.page.getByRole("button", { name: /^Fund / }).click();
await buyer.page.waitForURL(/#\/app\/deal\/\d+/, { timeout: 180000 });
const dealUrl = buyer.page.url();
const dealId = dealUrl.match(/deal\/(\d+)/)[1];
check("funded; the deal page opened", true, `deal ${dealId}`);

console.log("\n[flow] the seller delivers 2 cities");
await seller.page.goto(`${BASE}/?net=studio#/app/deal/${dealId}`);
await seller.page.getByPlaceholder("https://… the delivered work").fill(WORK);
await seller.page.getByRole("button", { name: "Compute digest" }).click();
await seller.page.getByText("bytes hashed in your browser").waitFor({ timeout: 30000 });
await seller.page.getByRole("button", { name: "Deliver", exact: true }).click();
await seller.page.getByText("Open for review").first().waitFor({ timeout: 180000 });
check("delivered; both clauses open for review", (await seller.page.getByText("Open for review").count()) === 2);

console.log("\n[flow] the buyer disputes 'cities' and convenes the jury");
await buyer.page.reload();
await buyer.page.getByPlaceholder(/Your note/).first().fill("Only two cities.");
await buyer.page.getByPlaceholder(/items\/71/).first().fill("/cities");
await buyer.page.getByRole("button", { name: /Dispute "cities"/ }).click();
await buyer.page.getByRole("button", { name: "Convene the jury" }).waitFor({ timeout: 180000 });
check("the note is shown as never reaching the jury", (await buyer.page.locator("main").innerText()).includes("never shown to the jury"));
check("the location is recorded on the dispute", (await buyer.page.locator("main").innerText()).includes("pointing the jury at /cities"));
await buyer.page.getByRole("button", { name: "Convene the jury" }).click();
await buyer.page.getByText(/Jury: (Unmet|Met|Undetermined)/).waitFor({ timeout: 300000 });
const text = await buyer.page.locator("main").innerText();
// innerText follows CSS text-transform, and badges are set in capitals.
check("the jury ruled", /Jury:\s*(Unmet|Met|Undetermined)/i.test(text), (text.match(/Jury:\s*\w+/) ?? [""])[0]);
check("2 cities against 'exactly 3' is unmet", /Jury:\s*Unmet/i.test(text));
check("the ruling waits out its appeal window before the escrow applies it", /after its appeal window/.test(text) && (await buyer.page.getByRole("button", { name: "Apply the ruling" }).count()) === 1);

console.log("\n[layout] phone width");
for (const width of [390, 360]) {
  await buyer.page.setViewportSize({ width, height: 844 });
  const wide = [];
  for (const route of ["#/", "#/how", "#/app", "#/app/new", `#/app/deal/${dealId}`, "#/docs", "#/docs/roadmap", "#/docs/integration"]) {
    await buyer.page.goto(`${BASE}/?net=studio${route}`);
    await buyer.page.waitForTimeout(2500);
    const o = await buyer.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (o > 1) {
      const culprits = await buyer.page.evaluate(() =>
        [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 3).map((e) => `${e.tagName}.${e.className}`));
      wide.push(`${route} +${o}px (${culprits.join(", ")})`);
    }
  }
  check(`no sideways scroll at ${width}px`, wide.length === 0, wide.join(", "));
}
await buyer.page.screenshot({ path: "e2e-deal-phone.png", fullPage: false });
check("no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
console.log(`\n${failures} failed checks`);
process.exit(failures ? 1 : 0);
