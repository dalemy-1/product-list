// tools/generate_product_pages.mjs
// Generate static preview pages for WhatsApp/Telegram link unfurling.
//
// Output:
//   /p/{marketLower}/{asinKey}/index.html
//
// Key features:
// - Does NOT delete existing /p/... pages (so delisted products keep working).
// - Uses OG meta tags for previews.
// - Human users are redirected to "/?open=/p/{marketLower}/{asinKey}" (SPA route).
//
// Usage:
//   node tools/generate_product_pages.mjs
//
// Env:
//   SITE_ORIGIN   (default: "https://ama.omino.top")
//   PRODUCTS_JSON (default: "./products.json")
//   OUT_DIR       (default: "./p")

import fs from "fs";
import path from "path";

const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://ama.omino.top").replace(/\/+$/, "");
const PRODUCTS_JSON = process.env.PRODUCTS_JSON || "./products.json";
const OUT_DIR = process.env.OUT_DIR || "./p";

// -------- utils --------
function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonSync(file) {
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw);
}

function normalizeMarket(m) {
  return String(m || "").trim().toUpperCase();
}

function normalizeAsin(a) {
  return String(a || "").trim().toUpperCase();
}

// For duplicates within same market+asin, create keys like ASIN_1, ASIN_2 ...
function annotateAsinKeys(products) {
  const counter = new Map();
  for (const p of products) {
    const M = normalizeMarket(p.market);
    const A = normalizeAsin(p.asin);
    const k = `${M}|${A}`;
    const seen = counter.get(k) || 0;
    p.__dupIndex = seen;
    p.__asinKey = seen > 0 ? `${A}_${seen}` : A;
    counter.set(k, seen + 1);
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return "";
}

function httpsify(u) {
  return String(u || "").replace(/^http:\/\//i, "https://");
}

function buildProductPath(marketLower, asinKey) {
  return `/p/${encodeURIComponent(marketLower)}/${encodeURIComponent(String(asinKey || ""))}/`;
}

function buildPreviewHtml({ market, asinKey, imageUrl }) {
  // IMPORTANT: do NOT use product title in the preview card
  const ogTitle = "Product Reference";
  const ogDesc =
    "Independent product reference. Purchases are completed on Amazon. As an Amazon Associate, we earn from qualifying purchases.";

  const marketUpper = normalizeMarket(market);
  const marketLower = marketUpper.toLowerCase();

  const pagePath = buildProductPath(marketLower, asinKey);
  const pageUrl = `${SITE_ORIGIN}${pagePath}`;

  // Redirect humans to SPA with ?open=...
  const openParam = `/?open=${encodeURIComponent(pagePath.replace(/\/$/, ""))}`;
  const redirectUrl = `${SITE_ORIGIN}${openParam}`;

  const img = httpsify(safeUrl(imageUrl));

  // If no image, still output OG tags but omit og:image to reduce failures.
  const ogImageTags = img
    ? `
<meta property="og:image" content="${escapeHtml(img)}"/>
<meta name="twitter:image" content="${escapeHtml(img)}"/>
<meta name="twitter:card" content="summary_large_image"/>
`
    : `
<meta name="twitter:card" content="summary"/>
`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>

<title>${escapeHtml(marketUpper)} • ${escapeHtml(asinKey)} • Product Picks</title>
<meta name="description" content="${escapeHtml(ogDesc)}"/>

<meta property="og:type" content="product"/>
<meta property="og:site_name" content="Product Picks"/>
<meta property="og:title" content="${escapeHtml(ogTitle)}"/>
<meta property="og:description" content="${escapeHtml(ogDesc)}"/>
<meta property="og:url" content="${escapeHtml(pageUrl)}"/>
${ogImageTags}
<meta name="twitter:title" content="${escapeHtml(ogTitle)}"/>
<meta name="twitter:description" content="${escapeHtml(ogDesc)}"/>

<meta name="robots" content="index,follow"/>
<link rel="canonical" href="${escapeHtml(pageUrl)}"/>

<!-- Human users: handoff to SPA -->
<meta http-equiv="refresh" content="0; url=${escapeHtml(redirectUrl)}"/>
</head>
<body>
<noscript>
  <p>Redirecting… <a href="${escapeHtml(redirectUrl)}">Open product page</a></p>
</noscript>
</body>
</html>`;
}

// -------- main --------
function main() {
  if (!fs.existsSync(PRODUCTS_JSON)) {
    console.error(`[generate] products.json not found: ${PRODUCTS_JSON}`);
    process.exit(1);
  }

  const listRaw = readJsonSync(PRODUCTS_JSON);
  if (!Array.isArray(listRaw)) {
    console.error("[generate] products.json must be an array");
    process.exit(1);
  }

  // Normalize fields
  const products = listRaw.map((p) => ({
    market: normalizeMarket(p.market ?? p.Market ?? p.MARKET ?? ""),
    asin: normalizeAsin(p.asin ?? p.ASIN ?? ""),
    // title intentionally ignored for preview
    image_url: String(p.image_url ?? p.image ?? p.Image ?? "").trim(),
  }));

  // Filter invalid
  const valid = products.filter((p) => p.market && p.asin);
  annotateAsinKeys(valid);

  // Ensure OUT_DIR exists (do NOT delete it)
  ensureDirSync(OUT_DIR);

  let wrote = 0;

  for (const p of valid) {
    const marketLower = p.market.toLowerCase();
    const asinKey = p.__asinKey || p.asin;

    const dir = path.join(OUT_DIR, marketLower, asinKey);
    ensureDirSync(dir);

    const html = buildPreviewHtml({
      market: p.market,
      asinKey,
      imageUrl: p.image_url,
    });

    const outFile = path.join(dir, "index.html");
    fs.writeFileSync(outFile, html, "utf8");
    wrote++;
  }

  console.log(
    `[generate] Done. Wrote/updated ${wrote} preview pages into ${OUT_DIR}/ (kept existing pages untouched).`
  );
  console.log(`[generate] SITE_ORIGIN=${SITE_ORIGIN}`);
  console.log(`[generate] PRODUCTS_JSON=${PRODUCTS_JSON}`);
}

main();
