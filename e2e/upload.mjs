// Headless-browser end-to-end test of the upload site on the LIVE devnet.
//   BASE=https://vaultchain-upload.vercel.app node e2e/upload.mjs
// It creates a brand-new throwaway profile, gets test funds from the public faucet (never from any shared account), then walks the
// 7-step stepper (one private and one public upload), downloads and decrypts the file, shares it with a contact and revokes it.
// Needs `playwright-core` (npm i --no-save playwright-core) and a Chrome/Chromium binary (CHROME=/path/to/chrome, default
// /usr/bin/google-chrome). Not part of CI. Screenshots go to $SHOTS (default e2e-shots). When BASE is not the production origin the
// faucet call is relayed through Node (the faucet only allows the production origin in browsers), everything else is real.
import fs from "node:fs";
import crypto from "node:crypto";

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error("playwright-core is not installed: run `npm i --no-save playwright-core`");
  process.exit(2);
}
const BASE = (process.env.BASE || "http://localhost:3000").replace(/\/$/, "");
const SHOTS = process.env.SHOTS || "e2e-shots";
const PROD = "https://vaultchain-upload.vercel.app";
const FAUCET = process.env.FAUCET_URL || "https://vaultchain-web.vercel.app/api/faucet";
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });

let pass = 0;
const fails = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    pass++;
    console.log(`ok   ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    fails.push(name);
    console.log(`FAIL ${name}: ${String(e.message).split("\n")[0]}`);
    try {
      await page.screenshot({ path: `${SHOTS}/fail-${fails.length}.png`, fullPage: true });
    } catch {}
    if (fails.length >= 2) {
      // Later steps depend on earlier ones: stop instead of waiting for timeouts.
      console.log(`\n${pass} passed, ${fails.length} failed (stopped early): ${fails.join("; ")}`);
      await browser.close();
      process.exit(1);
    }
  }
}
const expect = (c, m) => {
  if (!c) throw new Error(m);
};
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
if (BASE !== PROD) {
  await page.route(FAUCET, async (route) => {
    const req = route.request();
    const r = await fetch(FAUCET, { method: req.method(), headers: { "content-type": "application/json" }, body: req.method() === "POST" ? req.postData() : undefined });
    await route.fulfill({ status: r.status, body: await r.text(), headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
  });
}

const PASS = `e2e-${crypto.randomBytes(6).toString("hex")}-Correct-Horse-9`;
const NAME = `E2E ${new Date().toISOString().slice(11, 19)}`;
const secret = Buffer.from(`hello from the e2e test ${crypto.randomUUID()}\n`.repeat(40));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const FAUCET_ADDR = "vault1dwa8g26hsy0p20tx0yfz3mct8k86r8tdv36qye";
let link = "";
let publicLink = "";
const click = (re) => page.getByRole("button", { name: re }).first().click();

await step("home loads with the 7-step stepper and shared brand header/footer", async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  expect((await page.locator("nav[aria-label] ol li").count()) === 7, "7 steps");
  for (const t of ["Home", "Docs", "Vault", "Explorer", "Upload"]) expect((await page.locator("header").getByText(t, { exact: true }).count()) > 0, "cross-nav " + t);
  expect((await page.locator("footer").count()) > 0, "footer");
  await shot("01-home");
});

await step("create a profile (passphrase rules + acknowledgement)", async () => {
  await page.getByLabel("Profile name").fill(NAME);
  const pw = page.locator("input[type=password]");
  await pw.nth(0).fill("short");
  await pw.nth(1).fill("short");
  expect((await page.locator(".issues li").count()) > 0, "weak passphrase explained");
  await pw.nth(0).fill(PASS);
  await pw.nth(1).fill(PASS);
  await shot("02-profile");
  await page.getByRole("checkbox").check();
  await click(/^Create profile$/);
  await page.getByText(/Back up .* now/).waitFor({ timeout: 20000 });
});

await step("funds step: one click gets free VAULT from the faucet", async () => {
  await page.getByRole("button", { name: /Get \d+ free VAULT/ }).waitFor({ timeout: 20000 });
  await shot("03-funds");
  await click(/Get \d+ free VAULT/);
  await page.getByRole("button", { name: /^Continue$/ }).waitFor({ timeout: 90000 });
  await shot("04-funded");
  await click(/^Continue$/);
  await page.locator('[data-testid="file-input"]').waitFor({ state: "attached", timeout: 10000 });
});

await step("files step: rejects an empty file with a clear message, accepts real files, previews them", async () => {
  const input = page.locator('[data-testid="file-input"]');
  await input.setInputFiles({ name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) });
  await page.locator(".issues-list").waitFor({ timeout: 5000 });
  expect(/empty/i.test(await page.locator(".issues-list").innerText()), "empty-file message");
  await input.setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: secret },
    { name: "pixel.png", mimeType: "image/png", buffer: png },
  ]);
  await page.getByText("notes.txt").first().waitFor();
  await page.getByText("pixel.png").first().waitFor();
  await shot("05-files");
  await click(/^Next: choose options/);
});

await step("options step: plain-language privacy and duration with price estimates", async () => {
  await page.getByText(/Copies/i).first().waitFor();
  await page.getByText("About 1 hour").first().click();
  expect((await page.getByText(/≈ [\d.]+ VAULT/).count()) >= 5, "price estimates on every duration");
  await shot("06-options");
  await click(/^Next: review/);
});

await step("review step shows the total cost and starts the upload", async () => {
  await page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="total"]')?.textContent ?? ""), null, { timeout: 15000 });
  await shot("07-review");
  await page.locator('[data-testid="start-upload"]').click();
});

await step("upload step shows live progress, then the success screen with link + QR", async () => {
  await page.locator('[role="progressbar"]').first().waitFor({ timeout: 15000 });
  await shot("08-uploading");
  await page.locator('[data-testid="share-link"]').first().waitFor({ timeout: 240000 });
  link = await page.locator('[data-testid="share-link"]').first().inputValue();
  expect(/\/files\?open=[0-9a-f]{64}$/.test(link), "share link shape: " + link);
  await page.getByRole("button", { name: /QR code/ }).first().click();
  expect((await page.locator("svg[role=img]").count()) > 0, "QR rendered");
  expect(((await page.getByRole("link", { name: /View in the explorer/ }).first().getAttribute("href")) || "").includes("/files/"), "explorer link");
  await shot("09-done");
});

await step("a public upload works too (automatic public access)", async () => {
  await click(/Upload more/);
  await page.locator('[data-testid="file-input"]').waitFor({ state: "attached" });
  await page.locator('[data-testid="file-input"]').setInputFiles({ name: "public.txt", mimeType: "text/plain", buffer: Buffer.from("public file " + crypto.randomUUID()) });
  await click(/^Next: choose options/);
  await page.getByText(/Public/).first().click();
  await page.getByText("About 1 hour").first().click();
  await click(/^Next: review/);
  await page.getByText(/anyone with the link/i).first().waitFor();
  await page.locator('[data-testid="start-upload"]').click();
  await page.locator('[data-testid="share-link"]').first().waitFor({ timeout: 240000 });
  publicLink = await page.locator('[data-testid="share-link"]').first().inputValue();
});

await step("my files: opening the link after a reload asks to unlock, then shows and highlights the file", async () => {
  await page.goto(link, { waitUntil: "networkidle" });
  await page.locator(".profilebar").getByRole("button", { name: /^Unlock$/ }).click();
  await page.locator("input[type=password]").fill(PASS);
  await page.locator("form.unlock button[type=submit]").click();
  await page.locator('[data-testid="file-row"].opened').waitFor({ timeout: 30000 });
  expect((await page.locator('[data-testid="file-row"]').count()) === 3, "three files listed (2 private + 1 public)");
  await shot("10-library");
});

await step("download decrypts in the browser and matches the original bytes", async () => {
  const row = page.locator('[data-testid="file-row"]', { hasText: "notes.txt" });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), row.getByRole("button", { name: /^Download$/ }).click()]);
  const p = await dl.path();
  expect(Buffer.compare(fs.readFileSync(p), secret) === 0, "downloaded bytes equal the original");
  expect(dl.suggestedFilename() === "notes.txt", "file name kept");
});

await step("preview shows the image", async () => {
  const row = page.locator('[data-testid="file-row"]', { hasText: "pixel.png" });
  await row.getByRole("button", { name: /^Preview$/ }).click();
  await row.locator("img.preview-img").waitFor({ timeout: 30000 });
  await shot("11-preview");
});

await step("search and filters narrow the list", async () => {
  await page.getByRole("searchbox", { name: /Search/ }).fill("public");
  await page.waitForTimeout(200);
  expect((await page.locator('[data-testid="file-row"]').count()) === 1, "search narrows to 1");
  await page.getByRole("searchbox", { name: /Search/ }).fill("");
  await page.getByLabel("Show").selectOption("private");
  expect((await page.locator('[data-testid="file-row"]').count()) === 2, "private filter shows 2");
  await page.getByLabel("Show").selectOption("all");
});

await step("contacts: add one, share a private file with them, then remove access", async () => {
  await page.getByRole("link", { name: "Contacts" }).first().click();
  await page.getByLabel("Name").fill("Faucet bot");
  await page.getByLabel("Address").fill(FAUCET_ADDR);
  await click(/^Add contact$/);
  await page.getByText("Faucet bot").first().waitFor();
  await shot("12-contacts");
  await page.getByRole("link", { name: "My files" }).first().click();
  const row = page.locator('[data-testid="file-row"]', { hasText: "notes.txt" });
  await row.getByRole("button", { name: /Share & details/ }).click();
  await row.getByLabel("Share with").selectOption({ label: /Faucet bot/ }).catch(async () => row.getByLabel("Share with").selectOption(FAUCET_ADDR));
  await row.getByRole("button", { name: /^Share$/ }).click();
  await row.getByText("Faucet bot").first().waitFor({ timeout: 90000 });
  await shot("13-shared");
  await row.getByRole("button", { name: /^Remove$/ }).click();
  await row.getByText("Only you right now.").waitFor({ timeout: 90000 });
});

await step("account: address, published key and settings", async () => {
  await page.getByRole("link", { name: /Account/ }).first().click();
  await page.getByText(/public key is published/i).waitFor({ timeout: 20000 });
  await shot("14-account");
});

await step("mobile: no horizontal scrolling on any page", async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const p of ["/", "/files", "/contacts", "/account"]) {
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over <= 1, `${p} overflows by ${over}px`);
  }
  await shot("15-mobile");
});

await step("no uncaught page errors", async () => {
  expect(errors.length === 0, errors.slice(0, 3).join(" | "));
});

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed${fails.length ? ": " + fails.join("; ") : ""}`);
void publicLink;
process.exit(fails.length ? 1 : 0);
