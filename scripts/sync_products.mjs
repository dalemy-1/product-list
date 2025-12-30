// scripts/sync_products.mjs
// One-shot pipeline:
// 1) Fetch CSV from CSV_URL (source of truth)
// 2) Rebuild products.json + archive.json
// 3) Generate /p/{market}/{asinKey}/index.html pages for stable share URLs
//
// Required env:
//   CSV_URL=https://.../export_csv
//
// Optional env:
//   SITE_ORIGIN=https://ama.omino.top   (used for /p page generation)
//   OUT_DIR=./p                         (defaults to ./p)

import fs from "fs";
import path from "path";
import process from "process";

// ================== ENV ==================
const CSV_URL = (process.env.CSV_URL || "").trim();
if (!CSV_URL) {
  console.error("[error] CSV_URL is empty. Set env CSV_URL in workflow.");
  process.exit(1);
}

const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://ama.omino.top").replace(/\/+$/, "");
const OUT_DIR = (process.env.OUT_DIR || "./p").trim();

// ================== PATHS ==================
const ROOT = process.cwd();
const PRODUCTS_PATH = path.join(ROOT, "products.json");
const ARCHIVE_PATH = path.join(ROOT, "archive.json");

// ================== HELPERS ==================
function norm(s) {
  return String(s ?? "").trim();
}
function upper(s) {
  return norm(s).toUpperCase();
}
function normalizeMarket(v) {
  return upper(v);
}
function normalizeAsin(v) {
  return upper(v);
}
function normalizeUrl(v) {
  const s = norm(v);
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return "";
}
function safeHttps(url) {
  return norm(url).replace(/^http:\/\//i, "https://");
}
function safeReadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const txt = fs.readFileSync(file, "utf8");
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}
function writeJsonPretty(file, obj) {
  const json = JSON.stringify(obj, null, 2) + "\n";
  fs.writeFileSync(file, json, "utf8");
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Minimal CSV parser supporting quoted fields and commas inside quotes.
function parseCSV(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }

    field += c;
    i++;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function mapRow(headers, cells) {
  const obj = {};
  headers.forEach((h, idx) => {
    obj[h] = norm(cells[idx] ?? "");
  });
  return obj;
}

function isActiveStatus(v) {
  const s = norm(v).toLowerCase();
  if (!s) return true; // CSV 未填 status => 默认上架
  return ["1", "true", "yes", "on", "active", "enabled", "publish", "published", "online"].includes(s);
}

function keyOf(p) {
  return `${upper(p.market)}|${upper(p.asin)}`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "github-actions-sync/1.0",
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
  });
  if (!res.ok) throw new Error(`Fetch CSV failed: HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

// ================== /p PAGE GENERATOR ==================
// Always use Weserv for OG image (stable https)
function toWeservOg(url) {
  const u = safeHttps(url);
  if (!u) return "";
  const cleaned = u.replace(/^https?:\/\//i, "");
  return `https://images.weserv.nl/?url=${encodeURIComponent(cleaned)}&w=1200&h=630&fit=cover&output=jpg`;
}

function annotateAsinKeys(list) {
  const counter = new Map();
  for (const p of list) {
    const m = upper(p.market);
    const a = upper(p.asin);
    const k = `${m}|${a}`;
    const seen = counter.get(k) || 0;
    p.__asinKey = seen === 0 ? a : `${a}_${seen}`;
    counter.set(k, seen + 1);
  }
}

function buildPreviewHtml({ market, asinKey, imageUrl }) {
  const mLower = String(market).toLowerCase();
  const pagePath = `/p/${encodeURIComponent(mLower)}/${encodeURIComponent(asinKey)}/`;
  const pageUrl = SITE_ORIGIN + pagePath;

  // IMPORTANT:
  // This preview page should NOT redirect to Amazon.
  // It redirects to your site's own product page (index.html handles ?open=).
  const openParam = encodeURIComponent(pagePath);
  const redirectUrl = `${SITE_ORIGIN}/?open=${openParam}`;

  const ogTitle = `Product Reference • ${upper(market)} • ${asinKey}`;
  const ogDesc =
    "Independent product reference. Purchases are completed on Amazon. As an Amazon Associate, we earn from qualifying purchases.";

  const ogImage = toWeservOg(imageUrl) || `${SITE_ORIGIN}/og-placeholder.jpg`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />

  <title>${escapeHtml(ogTitle)} • Product Picks</title>
  <meta name="description" content="${escapeHtml(ogDesc)}" />

  <meta property="og:type" content="website" />
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

  <!-- Redirect to your own site product UI (NOT Amazon) -->
  <meta http-equiv="refresh" content="0; url=${escapeHtml(redirectUrl)}" />
</head>
<body>
  <noscript>
    <p>Redirecting… <a href="${escapeHtml(redirectUrl)}">Open product page</a></p>
  </noscript>
</body>
</html>`;
}

function generatePPages(activeList, archiveList) {
  const outDirAbs = path.isAbsolute(OUT_DIR) ? OUT_DIR : path.join(ROOT, OUT_DIR);
  ensureDir(outDirAbs);

  const all = [...(activeList || []), ...(archiveList || [])].filter((p) => p && p.market && p.asin);

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

  let count = 0;
  for (const p of all) {
    const market = upper(p.market);
    const asinKey = p.__asinKey;
    const img = norm(p.image_url);

    const dir = path.join(outDirAbs, market.toLowerCase(), asinKey);
    ensureDir(dir);

    const html = buildPreviewHtml({ market, asinKey, imageUrl: img });
    fs.writeFileSync(path.join(dir, "index.html"), html, "utf-8");
    count++;
  }

  console.log(`[p] generated ${count} pages under ${OUT_DIR}`);
}

// ================== MAIN ==================
(async () => {
  console.log("[sync] CSV_URL =", CSV_URL);

  const csvText = await fetchText(CSV_URL);
  console.log("[sync] CSV bytes =", csvText.length);

  const rows = parseCSV(csvText);
  if (!rows.length) throw new Error("CSV is empty");

  const headers = rows[0].map((h) => norm(h));
  const dataRows = rows
    .slice(1)
    .filter((r) => r.some((c) => norm(c) !== ""));

  console.log("[sync] headers =", headers.join(" | "));
  console.log("[sync] data rows =", dataRows.length);

  const prevProducts = Array.isArray(safeReadJson(PRODUCTS_PATH, [])) ? safeReadJson(PRODUCTS_PATH, []) : [];
  const prevArchive = Array.isArray(safeReadJson(ARCHIVE_PATH, [])) ? safeReadJson(ARCHIVE_PATH, []) : [];

  const prevMap = new Map();
  prevProducts.forEach((p) => prevMap.set(keyOf(p), p));

  const archiveMap = new Map();
  prevArchive.forEach((p) => archiveMap.set(keyOf(p), p));

  // Build new active list from CSV (source of truth)
  const nextProducts = [];
  for (const r of dataRows) {
    const o = mapRow(headers, r);

    const market = normalizeMarket(o.market || o.Market || o.MARKET);
    const asin = normalizeAsin(o.asin || o.ASIN);
    if (!market || !asin) continue;

    const statusVal = o.status ?? o.Status ?? o.STATUS;
    if (!isActiveStatus(statusVal)) continue;

    const link = normalizeUrl(o.link || o.Link);
    const image_url = norm(o.image_url || o.image || o.Image || o.imageUrl || "");

    nextProducts.push({
      market,
      asin,
      title: norm(o.title || o.Title || ""),
      link,
      image_url,
    });
  }

  nextProducts.sort((a, b) => {
    const am = a.market.localeCompare(b.market);
    if (am) return am;
    return a.asin.localeCompare(b.asin);
  });

  // Move removed items into archive
  const nextKeys = new Set(nextProducts.map(keyOf));
  let removedCount = 0;

  for (const [k, oldP] of prevMap.entries()) {
    if (!nextKeys.has(k)) {
      if (!archiveMap.has(k)) archiveMap.set(k, oldP);
      removedCount++;
    }
  }

  const nextArchive = Array.from(archiveMap.values());
  nextArchive.sort((a, b) => {
    const am = a.market.localeCompare(b.market);
    if (am) return am;
    return a.asin.localeCompare(b.asin);
  });

  console.log("[sync] next active =", nextProducts.length);
  console.log("[sync] removed from active =", removedCount);
  console.log("[sync] archive size =", nextArchive.length);

  writeJsonPretty(PRODUCTS_PATH, nextProducts);
  writeJsonPretty(ARCHIVE_PATH, nextArchive);
  console.log("[sync] wrote products.json & archive.json");

  // Generate /p pages
  generatePPages(nextProducts, nextArchive);

  console.log("[done] sync + generate /p pages completed");
})().catch((err) => {
  console.error("[fatal]", err?.stack || err);
  process.exit(1);
});
