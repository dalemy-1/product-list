// tools/generate_product_pages.mjs
// Generate social-preview pages under /p/{market}/{asinKey}/index.html
// Uses Open Graph tags for WhatsApp/Telegram previews.
// IMPORTANT: Title is neutral and DOES NOT use product title (to avoid showing CN titles).

import fs from "fs";
import path from "path";

const REPO_ROOT = process.cwd();
const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://ama.omino.top").replace(/\/+$/, "");

const PRODUCTS_JSON = path.join(REPO_ROOT, "products.json");
const ARCHIVE_JSON = path.join(REPO_ROOT, "archive.json");
const OUT_DIR = path.join(REPO_ROOT, "p");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fallback; }
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function norm(s) { return String(s ?? "").trim(); }
function upper(s) { return norm(s).toUpperCase(); }
function safeHttps(url) { return norm(url).replace(/^http:\/\//i, "https://"); }

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#39;");
}

// duplicates: market+asin may appear multiple times. Build asinKey = ASIN or ASIN_1, ASIN_2...
function annotateAsinKeys(list) {
  const counter = new Map();
  for (const p of list) {
    const m = upper(p.market);
    const a = upper(p.asin);
    const key = `${m}|${a}`;
    const seen = counter.get(key) || 0;
    const asinKey = seen === 0 ? a : `${a}_${seen}`;
    p.__asinKey = asinKey;
    counter.set(key, seen + 1);
  }
}

function buildPreviewHtml({ market, asinKey, imageUrl }) {
  const m = String(market).toLowerCase();
  const pagePath = `/p/${encodeURIComponent(m)}/${encodeURIComponent(asinKey)}/`;
  const pageUrl = SITE_ORIGIN + pagePath;

  // 用 open 参数跳回 SPA（你 index.html 已支持 ?open=/p/xx/yyy）
  const openParam = encodeURIComponent(pagePath);
  const redirectUrl = `${SITE_ORIGIN}/?open=${openParam}`;

  const ogTitle = `Product Reference • ${upper(market)} • ${asinKey}`;
  const ogDesc = `Independent product reference. Purchases are completed on Amazon. As an Amazon Associate, we earn from qualifying purchases.`;

  const img = safeHttps(imageUrl || "");
  // WhatsApp/Telegram 对图片抓取要求比较苛刻：建议保证是 https 且可公网访问
  const ogImage = img || `${SITE_ORIGIN}/og-placeholder.png`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />

  <title>${escapeHtml(ogTitle)} • Product Picks</title>
  <meta name="description" content="${escapeHtml(ogDesc)}" />

  <meta property="og:type" content="product" />
  <meta property="og:site_name" content="Product Picks" />
  <meta property="og:title" content="${escapeHtml(ogTitle)}" />
  <meta property="og:description" content="${escapeHtml(ogDesc)}" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(ogDesc)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

  <meta name="robots" content="index,follow" />

  <!-- quick redirect for humans -->
  <meta http-equiv="refresh" content="0; url=${escapeHtml(redirectUrl)}" />
</head>
<body>
  <noscript>
    <p>Redirecting… <a href="${escapeHtml(redirectUrl)}">Open product page</a></p>
  </noscript>
</body>
</html>`;
}

function main() {
  if (!fs.existsSync(PRODUCTS_JSON)) {
    console.error("Missing products.json at repo root");
    process.exit(1);
  }

  const active = readJson(PRODUCTS_JSON, []);
  const archive = readJson(ARCHIVE_JSON, []);
  const all = [...active, ...archive].filter(p => p && p.market && p.asin);

  // stable ordering helps keep keys stable
  all.sort((a, b) => {
    const ma = upper(a.market), mb = upper(b.market);
    if (ma !== mb) return ma.localeCompare(mb);
    const aa = upper(a.asin), ab = upper(b.asin);
    if (aa !== ab) return aa.localeCompare(ab);
    return 0;
  });

  annotateAsinKeys(all);

  // clean output dir
  ensureDir(OUT_DIR);

  // generate pages
  let count = 0;
  for (const p of all) {
    const market = upper(p.market);
    const asinKey = p.__asinKey;
    const img = norm(p.image_url);

    const dir = path.join(OUT_DIR, market.toLowerCase(), asinKey);
    ensureDir(dir);

    const html = buildPreviewHtml({
      market,
      asinKey,
      imageUrl: img
    });

    fs.writeFileSync(path.join(dir, "index.html"), html, "utf-8");
    count++;
  }

  console.log(`[preview] generated ${count} pages under /p`);
}

main();
