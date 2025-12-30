// tools/generate_product_pages.mjs
// Generate /p/{market}/{asinKey}/index.html for stable share URLs (WhatsApp/Telegram).
// FINAL VERSION (direct static product page, NO redirect to homepage).
// Key changes:
// 1) Filter out non-Amazon items: ASIN that is ALL DIGITS (e.g., Walmart) will be skipped.
// 2) /p pages are real standalone pages (white UI) and will NOT redirect to "/?open=...".
// 3) OG/Twitter meta uses images.weserv.nl proxy for stable HTTPS previews.
// 4) Deterministic asinKey assignment with stable ordering + duplicate handling.

import fs from "fs";
import path from "path";

const REPO_ROOT = process.cwd();
const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://ama.omino.top").replace(/\/+$/, "");

const PRODUCTS_JSON = path.join(REPO_ROOT, "products.json");
const ARCHIVE_JSON = path.join(REPO_ROOT, "archive.json");
const OUT_DIR = path.join(REPO_ROOT, "p");

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fallback;
  }
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function norm(s) {
  return String(s ?? "").trim();
}
function upper(s) {
  return norm(s).toUpperCase();
}
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function safeHttps(url) {
  return norm(url).replace(/^http:\/\//i, "https://");
}

function normalizeList(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.items)) return json.items;
  return [];
}

// --- ASIN rules ---
// Amazon ASIN is typically 10 chars, letters+digits (often starts with B...).
// Your rule: Walmart/other platform ASIN are all digits => hide them.
function isAllDigitsAsin(asin) {
  const a = upper(asin);
  return a.length > 0 && /^[0-9]+$/.test(a);
}
// Allow only "Amazon-like" asin for page generation.
// We strictly exclude ALL-DIGITS. Everything else we keep (to avoid accidental hiding).
function isAllowedAsin(asin) {
  if (!asin) return false;
  if (isAllDigitsAsin(asin)) return false;
  return true;
}

// --- image proxy ---
function toWeservOg(url) {
  const u = safeHttps(url);
  if (!u) return "";
  const cleaned = u.replace(/^https?:\/\//i, "");
  return `https://images.weserv.nl/?url=${encodeURIComponent(cleaned)}&w=1200&h=630&fit=cover&output=jpg`;
}
function toWeservView(url) {
  const u = safeHttps(url);
  if (!u) return "";
  const cleaned = u.replace(/^https?:\/\//i, "");
  return `https://images.weserv.nl/?url=${encodeURIComponent(cleaned)}&w=1400&h=1400&fit=contain&output=jpg`;
}

// duplicates: market+asin may repeat -> ASIN, ASIN_1, ASIN_2...
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

function buildWhitePageHtml({ market, asin, asinKey, imageUrl, amazonLink }) {
  const mLower = String(market).toLowerCase();
  const pagePath = `/p/${encodeURIComponent(mLower)}/${encodeURIComponent(asinKey)}/`;
  const pageUrl = SITE_ORIGIN + pagePath;

  const ogTitle = `Product Reference • ${upper(market)} • ${asinKey}`;
  const ogDesc =
    "Independent product reference. Purchases are completed on Amazon. As an Amazon Associate, we earn from qualifying purchases.";
  const ogImage = toWeservOg(imageUrl) || `${SITE_ORIGIN}/og-placeholder.jpg`;

  const viewImg = toWeservView(imageUrl);
  // View on Amazon -> uses open.html to avoid referrer/cookie issues & keep behavior consistent
  const openUrl =
    `${SITE_ORIGIN}/open.html?market=${encodeURIComponent(upper(market))}&asin=${encodeURIComponent(upper(asin))}` +
    (amazonLink ? `&link=${encodeURIComponent(amazonLink)}` : "");

  // Back: prefer root list (index.html)
  const backUrl = `${SITE_ORIGIN}/index.html`;

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
  <meta property="og:image:secure_url" content="${escapeHtml(ogImage)}" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(ogDesc)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

  <meta name="robots" content="index,follow" />

  <style>
    :root{
      --bg:#eef2f6;
      --card:#ffffff;
      --border:#e5e7eb;
      --text:#111827;
      --muted:#6b7280;
      --btn:#0b1220;
      --btnText:#ffffff;
    }
    *{box-sizing:border-box}
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;background:var(--bg);color:var(--text)}
    header{background:radial-gradient(1200px 360px at 50% 0%, #1f2a44, #0b1220);color:#fff;text-align:center;padding:22px 14px 18px}
    header .h{font-size:34px;font-weight:900;letter-spacing:.2px}
    .wrap{max-width:1100px;margin:0 auto;padding:18px 14px 44px}
    .topbar{
      background:var(--card);
      border:1px solid var(--border);
      border-radius:16px;
      padding:14px 14px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      flex-wrap:wrap;
      box-shadow:0 10px 24px rgba(15,23,42,.08);
      margin-bottom:14px;
    }
    .topbar .left{display:flex;flex-direction:column;gap:2px}
    .topbar .title{font-weight:900}
    .topbar .meta{color:var(--muted);font-size:12px}
    .actions{display:flex;gap:10px;flex-wrap:wrap}
    .btn{
      display:inline-flex;align-items:center;justify-content:center;
      padding:10px 14px;border-radius:12px;border:1px solid var(--border);
      background:#fff;color:var(--text);text-decoration:none;font-weight:800;cursor:pointer;
    }
    .btn.primary{background:var(--btn);color:var(--btnText);border-color:rgba(255,255,255,.12)}
    .btn:hover{opacity:.96}
    .card{
      background:var(--card);
      border:1px solid var(--border);
      border-radius:18px;
      padding:16px;
      box-shadow:0 12px 30px rgba(15,23,42,.08);
    }
    .imgbox{
      background:#fff;
      border:1px solid var(--border);
      border-radius:16px;
      padding:14px;
      display:flex;align-items:center;justify-content:center;
      min-height:520px;
    }
    .imgbox img{max-width:100%;max-height:720px;object-fit:contain;border-radius:12px}
    .noteBox{
      margin:12px auto 0;
      max-width:520px;
      border:1px solid var(--border);
      background:#f8fafc;
      border-radius:14px;
      padding:12px 14px;
      color:var(--text);
      font-size:12px;
      line-height:1.45;
      text-align:left;
    }
    .noteBox .t{font-weight:900;margin-bottom:6px}
    .ctaRow{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:12px}
    .disclosure{
      margin-top:14px;
      border:1px solid var(--border);
      background:#f8fafc;
      border-radius:14px;
      padding:12px 14px;
      font-size:12px;
      color:var(--muted);
      line-height:1.5;
    }
    footer{
      margin-top:18px;
      font-size:12px;
      color:var(--muted);
      line-height:1.6;
      max-width:1100px;
      margin-left:auto;margin-right:auto;
    }
    footer a{color:#2563eb;text-decoration:none}
    footer a:hover{text-decoration:underline}
    code{background:#f1f5f9;border:1px solid #e2e8f0;padding:1px 6px;border-radius:999px}
  </style>
</head>
<body>
  <header>
    <div class="h">Product Picks</div>
  </header>

  <div class="wrap">
    <div class="topbar">
      <div class="left">
        <div class="title">Product Reference</div>
        <div class="meta">Market: ${escapeHtml(upper(market))} · ASIN: ${escapeHtml(
    upper(asin)
  )} · Key: ${escapeHtml(upper(asinKey))}</div>
      </div>
      <div class="actions">
        <a class="btn" href="${escapeHtml(backUrl)}">← Back</a>
        <button class="btn" id="copyLinkBtn" type="button">Copy page link</button>
        <button class="btn" id="copyBtn" type="button">Contact / Copy</button>
      </div>
    </div>

    <div class="card">
      <div class="imgbox">
        <img id="img" src="${escapeHtml(viewImg || "")}" alt="Product image" />
      </div>

      <div class="noteBox">
        <div class="t">Selection note</div>
        <div>Chosen for straightforward use and clear selection steps.</div>
        <div>• Check: size/variant selection and what's included.</div>
        <div>• Tip: confirm seller/fulfillment and return terms on Amazon.</div>
      </div>

      <div class="ctaRow">
        <a class="btn primary" href="${escapeHtml(openUrl)}" target="_blank" rel="noopener">View on Amazon</a>
        <button class="btn" id="copyBtn2" type="button">Contact / Copy</button>
      </div>

      <div class="disclosure">
        <b>Disclosure:</b> As an Amazon Associate, we earn from qualifying purchases.
        This is an independent site and is not endorsed by Amazon. Purchases are completed on Amazon via the product page.
      </div>
    </div>

    <footer>
      <div><b>Affiliate disclosure:</b> As an Amazon Associate, we earn from qualifying purchases.</div>
      <div><b>Independence:</b> This site is not an official Amazon website and is not endorsed by Amazon.</div>
      <div>Links: “View on Amazon” redirects to Amazon. Amazon may use cookies for tracking qualifying purchases.</div>
      <div style="margin-top:6px">
        <a href="${escapeHtml(SITE_ORIGIN + "/privacy.html")}">Privacy Policy</a> ·
        <a href="${escapeHtml(SITE_ORIGIN + "/terms.html")}">Terms</a>
      </div>
      <div>© 2025 ama.omino.top</div>
    </footer>
  </div>

<script>
(function(){
  var copyBtn = document.getElementById("copyBtn");
  var copyBtn2 = document.getElementById("copyBtn2");
  var copyLinkBtn = document.getElementById("copyLinkBtn");

  function copyText(t){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(t);
    } else {
      prompt("Copy:", t);
    }
  }

  function doCopy(){
    copyText("Market: ${escapeHtml(upper(market))}\\nASIN: ${escapeHtml(upper(asin))}\\nPage: " + location.href);
    var old1 = copyBtn.textContent;
    var old2 = copyBtn2.textContent;
    copyBtn.textContent = "Copied";
    copyBtn2.textContent = "Copied";
    setTimeout(function(){ copyBtn.textContent = old1; copyBtn2.textContent = old2; }, 900);
  }

  copyBtn.addEventListener("click", doCopy);
  copyBtn2.addEventListener("click", doCopy);

  copyLinkBtn.addEventListener("click", function(){
    copyText(location.href);
    var old = copyLinkBtn.textContent;
    copyLinkBtn.textContent = "Copied";
    setTimeout(function(){ copyLinkBtn.textContent = old; }, 900);
  });

  // img fallback to original (non-proxy) if proxy fails
  var img = document.getElementById("img");
  var raw = "${escapeHtml(safeHttps(imageUrl) || "")}";
  img.onerror = function(){ if(raw) img.src = raw; };
})();
</script>
</body>
</html>`;
}

function main() {
  if (!fs.existsSync(PRODUCTS_JSON)) {
    console.error("Missing products.json at repo root");
    process.exit(1);
  }

  const activeRaw = readJson(PRODUCTS_JSON, []);
  const archiveRaw = fs.existsSync(ARCHIVE_JSON) ? readJson(ARCHIVE_JSON, []) : [];

  const active = normalizeList(activeRaw);
  const archive = normalizeList(archiveRaw);

  // Union, filter required fields, and filter out ALL-DIGITS "asin" (Walmart/other).
  const all = [...active, ...archive]
    .filter((p) => p && p.market && p.asin)
    .map((p) => ({
      market: upper(p.market),
      asin: upper(p.asin),
      link: norm(p.link),
      image_url: norm(p.image_url),
    }))
    .filter((p) => isAllowedAsin(p.asin));

  // stable ordering -> stable asinKey assignment
  all.sort((a, b) => {
    const ma = upper(a.market),
      mb = upper(b.market);
    if (ma !== mb) return ma.localeCompare(mb);
    const aa = upper(a.asin),
      ab = upper(b.asin);
    if (aa !== ab) return aa.localeCompare(ab);
    return 0;
  });

  annotateAsinKeys(all);
  ensureDir(OUT_DIR);

  let count = 0;
  for (const p of all) {
    const market = upper(p.market);
    const asin = upper(p.asin);
    const asinKey = p.__asinKey;
    const img = norm(p.image_url);
    const link = norm(p.link);

    const dir = path.join(OUT_DIR, market.toLowerCase(), asinKey);
    ensureDir(dir);

    const html = buildWhitePageHtml({ market, asin, asinKey, imageUrl: img, amazonLink: link });
    fs.writeFileSync(path.join(dir, "index.html"), html, "utf-8");
    count++;
  }

  console.log(`[preview] generated ${count} pages under /p (digits-only ASIN skipped)`);
}

main();
