// Live end-to-end test of big files and reload-resume on the real devnet.
//   BASE=https://vaultchain-upload.vercel.app BIG_MB=70 node e2e/resume.mjs
// Creates a throwaway profile funded by the public faucet, starts a private upload of a random BIG_MB file (default 70 MiB, above the old 64 MiB
// limit), RELOADS THE PAGE part-way through the chunk upload, unlocks, presses "Resume upload", then checks that: no new transaction was signed
// (nothing was paid twice), the provider holds the complete object, and the downloaded file matches the original byte for byte.
// Also prints measured numbers (time per phase, peak JS heap). Needs playwright-core and Chrome; not part of CI.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
const NODE = process.env.NODE_URL || "https://vaultl1-devnet.fly.dev";
const PROVIDER = process.env.PROVIDER_URL || "https://vaultl1-provider.fly.dev";
const BIG_MB = Number(process.env.BIG_MB || 70);
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
if (BASE !== PROD) {
  await page.route(FAUCET, async (route) => {
    const req = route.request();
    const r = await fetch(FAUCET, { method: req.method(), headers: { "content-type": "application/json" }, body: req.method() === "POST" ? req.postData() : undefined });
    await route.fulfill({ status: r.status, body: await r.text(), headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
  });
}

let pass = 0;
const fails = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    pass++;
    console.log(`ok   ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  } catch (e) {
    fails.push(name);
    console.log(`FAIL ${name}: ${String(e.message).split("\n")[0]}`);
    try {
      await page.screenshot({ path: `${SHOTS}/resume-fail-${fails.length}.png`, fullPage: true });
    } catch {}
    console.log(`\n${pass} passed, ${fails.length} failed: ${fails.join("; ")}`);
    await browser.close();
    process.exit(1);
  }
}
const expect = (c, m) => {
  if (!c) throw new Error(m);
};
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const click = (re) => page.getByRole("button", { name: re }).first().click();
const PASS = `e2e-${crypto.randomBytes(6).toString("hex")}-Correct-Horse-9`;
const bigPath = path.join(os.tmpdir(), `vc-big-${process.pid}.bin`);
const heap = { max: 0 };
let address = "";
let root = "";
let nonceBefore = -1;
const nonceOf = async (a) => (await (await fetch(`${NODE}/vaultchain/auth/accounts/${a}`)).json()).nonce;

try {
  await step(`make a random ${BIG_MB} MiB file`, async () => {
    const fd = fs.openSync(bigPath, "w");
    for (let i = 0; i < BIG_MB; i++) fs.writeSync(fd, crypto.randomBytes(1024 * 1024));
    fs.closeSync(fd);
    expect(fs.statSync(bigPath).size === BIG_MB * 1024 * 1024, "size");
  });
  const srcHash = crypto.createHash("sha256").update(fs.readFileSync(bigPath)).digest("hex");

  await step("create a profile and get faucet funds", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.getByLabel("Profile name").fill(`E2E resume ${new Date().toISOString().slice(11, 19)}`);
    const pw = page.locator("input[type=password]");
    await pw.nth(0).fill(PASS);
    await pw.nth(1).fill(PASS);
    await page.getByRole("checkbox").check();
    await click(/^Create profile$/);
    await page.getByText(/Back up .* now/).waitFor({ timeout: 20000 });
    await click(/Get \d+ free VAULT/);
    await page.getByRole("button", { name: /^Continue$/ }).waitFor({ timeout: 90000 });
    await click(/^Continue$/);
    address = await page.evaluate(() => {
      const raw = Object.values(localStorage).find((v) => /vault1[0-9a-z]{30,}/.test(String(v)));
      return String(raw).match(/vault1[0-9a-z]{30,}/)[0];
    });
    expect(/^vault1/.test(address), "address found");
  });

  await step(`choose the ${BIG_MB} MiB file (above the old 64 MiB limit) and start a private upload`, async () => {
    await page.locator('[data-testid="file-input"]').setInputFiles(bigPath);
    await page.getByText(path.basename(bigPath)).first().waitFor({ timeout: 30000 });
    expect((await page.locator(".issues-list").count()) === 0, "no size complaint");
    await click(/^Next: choose options/);
    await page.getByText("About 1 hour").first().click();
    await click(/^Next: review/);
    await page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="total"]')?.textContent ?? ""), null, { timeout: 15000 });
    await page.locator('[data-testid="start-upload"]').click();
  });

  let tStart = Date.now();
  let total = 0;
  await step("upload runs; reload the page when about a third of the chunks are sent", async () => {
    tStart = Date.now();
    const sample = setInterval(async () => {
      try {
        const h = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
        heap.max = Math.max(heap.max, h);
      } catch {}
    }, 500);
    try {
      const deadline = Date.now() + 15 * 60_000;
      for (;;) {
        const txt = (await page.locator("body").innerText()).match(/Uploading chunks \((\d+)\/(\d+)\)/);
        if (txt) {
          total = Number(txt[2]);
          if (Number(txt[1]) >= Math.max(10, Math.floor(total / 3))) {
            await shot("resume-1-before-reload");
            console.log(`     reloading at ${txt[1]}/${txt[2]} chunks, ${((Date.now() - tStart) / 1000).toFixed(1)} s after starting`);
            break;
          }
        }
        expect(Date.now() < deadline, "never reached a third of the chunks");
        await page.waitForTimeout(250);
      }
    } finally {
      clearInterval(sample);
    }
    nonceBefore = await nonceOf(address);
    await page.reload({ waitUntil: "networkidle" });
  });

  await step("after the reload the page offers to resume (profile still locked)", async () => {
    await page.locator('[data-testid="resume-banner"]').waitFor({ timeout: 20000 });
    expect(/did not finish/i.test(await page.locator('[data-testid="resume-banner"]').innerText()), "banner text");
    expect((await page.locator('[data-testid="resume-row"]').count()) === 1, "one pending upload listed");
    await shot("resume-2-banner-locked");
    await page.locator("form.unlock input[type=password]").fill(PASS);
    await page.locator("form.unlock button[type=submit]").click();
    await page.locator('[data-testid="resume-btn"]').waitFor({ timeout: 30000 });
    await shot("resume-3-banner-unlocked");
  });

  await step("Resume upload finishes the job without signing any new transaction", async () => {
    const t = Date.now();
    await page.locator('[data-testid="resume-btn"]').click();
    await page.locator('[data-testid="resume-done"]').waitFor({ timeout: 15 * 60_000 });
    console.log(`     resumed part took ${((Date.now() - t) / 1000).toFixed(1)} s`);
    await shot("resume-4-done");
    const nonceAfter = await nonceOf(address);
    expect(nonceAfter === nonceBefore, `no new tx expected (nonce ${nonceBefore} -> ${nonceAfter})`);
    const href = await page.locator('[data-testid="resume-done"] a').getAttribute("href");
    root = (href.match(/open=([0-9a-f]{64})/) || [])[1];
    expect(root, "root in link");
    const st = await (await fetch(`${PROVIDER}/v1/objects/${root}/status`)).json();
    expect(st.complete === true, "provider reports the object complete");
    console.log(`     provider holds ${st.chunks_have}/${st.chunks_total} chunks`);
    const m = (await (await fetch(`${NODE}/vaultchain/storage/manifests/${root}`)).json()).manifest;
    expect(m.encryption === "vle1", "encrypted on chain");
    expect(m.size > BIG_MB * 1024 * 1024, "stored size is ciphertext size");
  });

  await step("download decrypts and matches the original bytes", async () => {
    await page.goto(`${BASE}/files?open=${root}`, { waitUntil: "networkidle" });
    await page.locator(".profilebar").getByRole("button", { name: /^Unlock$/ }).click();
    await page.locator("input[type=password]").fill(PASS);
    await page.locator("form.unlock button[type=submit]").click();
    const row = page.locator('[data-testid="file-row"].opened');
    await row.waitFor({ timeout: 60000 });
    const t = Date.now();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10 * 60_000 }), row.getByRole("button", { name: /^Download$/ }).click()]);
    const p = await dl.path();
    console.log(`     download+decrypt ${((Date.now() - t) / 1000).toFixed(1)} s`);
    const got = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    expect(got === srcHash, "sha256 of the downloaded file differs from the original");
  });

  await step("Extend storage opens a second deal that the provider confirms, without uploading again", async () => {
    const row = page.locator('[data-testid="file-row"].opened');
    const toggle = row.getByRole("button", { name: /Share & details|^Close$/ });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const dealsOf = async () => ((await (await fetch(`${NODE}/vaultchain/storage/deals?cid=${root}`)).json()).deals ?? []).length;
    const n0 = await dealsOf();
    await row.locator('[data-testid="extend-btn"]').click();
    await page.waitForFunction(() => /Storage extended|Payment sent/.test(document.body.innerText), null, { timeout: 120000 });
    const msg = await page.locator("body").innerText();
    await shot("resume-5-extended");
    const n1 = await dealsOf();
    expect(n1 === n0 + 1, `deals ${n0} -> ${n1}`);
    console.log(`     ${/Storage extended/.test(msg) ? "provider confirmed the new term" : "NOT confirmed within the wait (payment sent)"}`);
    expect(/Storage extended/.test(msg), "provider confirmed the extension");
  });

  console.log(`\nmeasured: ${BIG_MB} MiB file, ${total} chunks; peak JS heap during the first part of the upload ${(heap.max / 1048576).toFixed(0)} MiB`);
  console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
  expect(errors.length === 0, "page errors");
} finally {
  fs.rmSync(bigPath, { force: true });
}
console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
