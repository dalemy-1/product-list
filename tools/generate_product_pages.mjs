// tools/generate_product_pages.mjs
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
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#39;");
}
function safeHttps(url) { return norm(url).replace(/^http:\/\//i, "https://"); }

// OG image use weserv
function toWeservOg(url) {
  const u = safeHttps(url);
  if (!u) return "";
  const cleaned = u.replace(/^https?:\/\//i, "");
  return `https://images.weserv.nl/?url=${encodeURIComponent(cleaned)}&w=1200&h=630&fit=cover&output=jpg`;
}
function toWeservView(url){
  const u = safeHttps(url);
  if (!u) return "";
  const cleaned = u.replace(/^https?:\/\//i, "");
  return `https://images.weserv.nl/?url=${encodeURIComponent(cleaned)}&w=1200&h=1200&fit=contain&output=jpg`;
}

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

function buildPageHtml({ market, asin, asinKey, imageUrl, amazonLink }) {
  const mLower = String(market).toLowerCase();
  const pagePath = `/p/${encodeURIComponent(mLower)}/${encodeURIComponent(asinKey)}/`;
  const pageUrl = SITE_ORIGIN + pagePath;

  const ogTitle = `Product Reference • ${upper(market)} • ${asinKey}`;
  const ogDesc = `Independent product reference. Purchases are completed on Amazon. As an Amazon Associate, we earn from qualifying purchases.`;
  const ogImage = toWeservOg(imageUrl) || `${SITE_ORIGIN}/og-placeholder.jpg`;

  const viewImg = toWeservView(imageUrl);
  const openUrl = `${SITE_ORIGIN}/open.html?market=${encodeURIComponent(upper(market))}&asin=${encodeURIComponent(upper(asin))}` +
                  (amazonLink ? `&link=${encodeURIComponent(amazonLink)}` : "");

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

  <style>
    :root{--bg:#0b1220;--border:rgba(255,255,255,.12);--muted:rgba(255,255,255,.75)}
    *{box-sizing:border-box}
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;background:#0b1220;color:#fff}
    header{padding:16px 14px;text-align:center;font-weight:900;font-size:28px}
    .wrap{max-width:980px;margin:0 auto;padding:10px 14px 36px}
    .top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:8px 0 12px}
    .pill{background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:999px;padding:8px 12px;color:var(--muted);font-size:13px}
    .btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:12px;border:1px solid var(--border);text-decoration:none;font-weight:900;cursor:pointer}
    .btn.primary{background:#fff;color:#111827}
    .btn.secondary{background:transparent;color:#fff}
    .card{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:18px;padding:14px;box-shadow:0 12px 30px rgba(0,0,0,.25)}
    .imgbox{background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:16px;padding:12px;display:flex;align-items:center;justify-content:center;min-height:380px}
    .imgbox img{max-width:100%;max-height:520px;object-fit:contain;border-radius:12px}
    .note{color:var(--muted);font-size:13px;line-height:1.55;margin-top:10px}
    code{background:rgba(255,255,255,.08);padding:2px 6px;border-radius:8px}
    footer{margin-top:14px;color:rgba(255,255,255,.65);font-size:12px;line-height:1.5}
    a.link{color:#9cc2ff}
  </style>
</head>
<body>
  <header>Product Picks</header>
  <div class="wrap">
    <div class="top">
      <div class="pill">Market: <code>${escapeHtml(upper(market))}</code> &nbsp; ASIN: <code>${escapeHtml(upper(asinKey))}</code></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn secondary" href="${escapeHtml(SITE_ORIGIN + "/index.html")}">Back</a>
        <button class="btn secondary" id="copyBtn" type="button">Contact / Copy</button>
      </div>
    </div>

    <div class="card">
      <div class="imgbox">
        <img id="img" src="${escapeHtml(viewImg || "")}" alt="Product image" />
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        <a class="btn primary" href="${escapeHtml(openUrl)}" target="_blank" rel="noopener">View on Amazon</a>
        <button class="btn secondary" id="copyLinkBtn" type="button">Copy page link</button>
      </div>

      <div class="note">
        <b>Disclosure:</b> As an Amazon Associate, we earn from qualifying purchases.
        This is an independent site and is not endorsed by Amazon. Purchases are completed on Amazon via the product page.
      </div>

      <footer>
        <div><a class="link" href="${escapeHtml(SITE_ORIGIN + "/privacy.html")}">Privacy Policy</a> · <a class="link" href="${escapeHtml(SITE_ORIGIN + "/terms.html")}">Terms</a></div>
      </footer>
    </div>
  </div>

<script>
(function(){
  var copyBtn = document.getElementById("copyBtn");
  var copyLinkBtn = document.getElementById("copyLinkBtn");
  function copyText(t){
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(t);
    } else {
      prompt("Copy:", t);
    }
  }
  copyBtn.addEventListener("click", function(){
    copyText("Market: ${escapeHtml(upper(market))}\\nASIN: ${escapeHtml(upper(asin))}\\nPage: " + location.href);
    copyBtn.textContent = "Copied";
    setTimeout(()=>copyBtn.textContent="Contact / Copy", 900);
  });
  copyLinkBtn.addEventListener("click", function(){
    copyText(location.href);
    copyLinkBtn.textContent = "Copied";
    setTimeout(()=>copyLinkBtn.textContent="Copy page link", 900);
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

function normalizeList(json) {
  // 兼容：数组 或 {items:[...]}
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.items)) return json.items;
  return [];
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

  const all = [...active, ...archive].filter(p => p && p.market && p.asin);

  all.sort((a, b) => {
    const ma = upper(a.market), mb = upper(b.market);
    if (ma !== mb) return ma.localeCompare(mb);
    const aa = upper(a.asin), ab = upper(b.asin);
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

    const html = buildPageHtml({ market, asin, asinKey, imageUrl: img, amazonLink: link });
    fs.writeFileSync(path.join(dir, "index.html"), html, "utf-8");
    count++;
  }

  console.log(`[p-pages] generated ${count} pages under /p`);
}

main();
