import fs from "fs";
import path from "path";

const ROOT = process.cwd();

// 你的站点域名（GitHub Pages 自定义域名就是这个）
const SITE_ORIGIN = "https://ama.omino.top";

// products.json 路径（仓库根）
const PRODUCTS_JSON = path.join(ROOT, "products.json");

// 输出目录：在仓库内生成 /p/...
const OUT_DIR = path.join(ROOT, "p");

// 读取 products.json
if (!fs.existsSync(PRODUCTS_JSON)) {
  console.error("Missing products.json at:", PRODUCTS_JSON);
  process.exit(1);
}
const raw = fs.readFileSync(PRODUCTS_JSON, "utf-8");
let items = [];
try {
  items = JSON.parse(raw);
} catch (e) {
  console.error("products.json parse error:", e);
  process.exit(1);
}
if (!Array.isArray(items)) {
  console.error("products.json must be an array");
  process.exit(1);
}

function safeText(s) {
  return String(s ?? "").trim();
}
function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function normalizeMarket(m) {
  return safeText(m).toUpperCase();
}
function normalizeAsin(a) {
  return safeText(a).toUpperCase();
}
function ensureAbsUrl(u) {
  const s = safeText(u);
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return "";
}

// 处理重复 ASIN：同 market + asin 出现多次 => asinKey = ASIN / ASIN_1 / ASIN_2
const counter = new Map();
function buildAsinKey(market, asin) {
  const key = `${market}|${asin}`;
  const n = counter.get(key) || 0;
  counter.set(key, n + 1);
  return n === 0 ? asin : `${asin}_${n}`;
}

function buildPageUrl(marketLower, asinKey) {
  return `${SITE_ORIGIN}/p/${marketLower}/${encodeURIComponent(asinKey)}`;
}

// 生成静态 HTML：关键是 OG 标签（WhatsApp/Telegram 只看 head）
function buildHtml({ market, marketLower, asinKey, asin, title, imageUrl }) {
  const pageUrl = buildPageUrl(marketLower, asinKey);

  const ogTitle = title ? title : `ASIN ${asin}`;
  const ogDesc =
    "Independent product reference. Purchases are completed on Amazon. As an Amazon Associate, we earn from qualifying purchases.";

  // 尽量用高分辨率图：你 products.json 是 m.media-amazon.com，通常可用
  const ogImage = imageUrl;

  // 你可以选择：让页面直接跳转到你主站 SPA 详情（这样视觉保持一致）
  // 但注意：爬虫只抓这里的 OG，跳转不影响预览生成
  const redirectTo = `${SITE_ORIGIN}/?open=${encodeURIComponent(
    `/p/${marketLower}/${asinKey}`
  )}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>

  <title>${escHtml(ogTitle)} • ${escHtml(market)} • Product Picks</title>
  <meta name="description" content="${escHtml(ogDesc)}"/>

  <meta property="og:type" content="product"/>
  <meta property="og:site_name" content="Product Picks"/>
  <meta property="og:title" content="${escHtml(ogTitle)}"/>
  <meta property="og:description" content="${escHtml(ogDesc)}"/>
  <meta property="og:url" content="${escHtml(pageUrl)}"/>
  <meta property="og:image" content="${escHtml(ogImage)}"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:height" content="630"/>

  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escHtml(ogTitle)}"/>
  <meta name="twitter:description" content="${escHtml(ogDesc)}"/>
  <meta name="twitter:image" content="${escHtml(ogImage)}"/>

  <!-- optional: reduce indexing noise -->
  <meta name="robots" content="index,follow"/>

  <!-- human users see a clean handoff -->
  <meta http-equiv="refresh" content="0; url=${escHtml(redirectTo)}"/>
</head>
<body>
  <noscript>
    <p>Redirecting… <a href="${escHtml(redirectTo)}">Open product page</a></p>
  </noscript>
</body>
</html>`;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

// 清理旧输出（可选：避免删除你手工文件的话可注释掉）
if (fs.existsSync(OUT_DIR)) {
  // 只清理 OUT_DIR 下内容
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}
ensureDir(OUT_DIR);

// 生成
let count = 0;
for (const it of items) {
  const market = normalizeMarket(it.market || it.Market || it.MARKET);
  const asin = normalizeAsin(it.asin || it.ASIN);
  const title = safeText(it.title || it.Title);
  const imageUrl = ensureAbsUrl(it.image_url || it.imageUrl || it.image || it.Image);

  // 必要字段检查
  if (!market || !asin || !imageUrl) continue;

  const marketLower = market.toLowerCase();
  const asinKey = buildAsinKey(market, asin);

  const dir = path.join(OUT_DIR, marketLower, asinKey);
  ensureDir(dir);

  const html = buildHtml({ market, marketLower, asinKey, asin, title, imageUrl });
  fs.writeFileSync(path.join(dir, "index.html"), html, "utf-8");

  count++;
}

console.log(`Generated ${count} product preview pages under /p`);
