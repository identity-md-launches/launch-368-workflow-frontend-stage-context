import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const server = createServer((req, res) => {
  const path = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  ).replace(/^\/preview\//, "");
  if (path.includes("..") || path.startsWith("/")) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    res.writeHead(200, {
      "Content-Type": {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
      }[extname(path || "index.html")],
    });
    res.end(readFileSync(resolve(root, "dist", path || "index.html")));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
const result = {
  checkedAt: new Date().toISOString(),
  realTransactions: 0,
  walletConnected: false,
  errors: [],
};
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.on("pageerror", (e) => result.errors.push(e.message));
  page.on("requestfailed", (req) =>
    result.errors.push(req.url() + ": " + req.failure().errorText),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
  await page
    .getByText("Read at block", { exact: false })
    .waitFor({ timeout: 55000 });
  result.liveRead = await page.locator(".read-status").innerText();
  result.treasuryETH = await page.locator(".big-number").innerText();
  result.proposals = await page.locator(".count").innerText();
  result.pass = true;
  await page.screenshot({
    path: resolve(root, "docs/evidence/live-desktop.png"),
    fullPage: true,
  });
} catch (e) {
  result.pass = false;
  result.error = e.message;
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
writeFileSync(
  resolve(root, "docs/evidence/live-browser.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
