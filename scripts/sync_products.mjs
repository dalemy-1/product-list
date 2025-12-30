// scripts/sync_from_csv.mjs
// Rebuild products.json from CSV_URL every run (source of truth).
// Also maintain archive.json for removed/offline items.

import fs from "fs";
import path from "path";
import process from "process";

const CSV_URL = (process.env.CSV_URL || "").trim();
if (!CSV_URL) {
  console.error("[error] CSV_URL is empty. Set env CSV_URL in workflow.");
  process.exit(1);
}

const ROOT = process.cwd();
const PRODUCTS_PATH = path.join(ROOT, "products.json");
const ARCHIVE_PATH = path.join(ROOT, "archive.json");

// --- helpers ---
function normalizeMarket(v) {
  return String(v || "").trim().toUpperCase();
}
function normalizeAsin(v) {
  return String(v || "").trim().toUpperCase();
}
function normalizeUrl(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return "";
}

function safeReadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const txt = fs.readFileSync(file, "utf8");
    const obj = JSON.parse(txt);
    return obj;
  } catch {
    return fallback;
  }
}

function writeJsonPretty(file, obj) {
  const json = JSON.stringify(obj, null, 2) + "\n";
  fs.writeFileSync(file, json, "utf8");
}

// Minimal CSV parser that handles quoted fields and commas inside quotes.
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
        // double quote escape
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
  // last
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function mapRow(headers, cells) {
  const obj = {};
  headers.forEach((h, idx) => {
    obj[h] = (cells[idx] ?? "").trim();
  });
  return obj;
}

function isActiveStatus(v) {
  // 兼容你的 status 字段：空/active/on/1/true/yes 等都算上架（可按你实际改）
  const s = String(v || "").trim().toLowerCase();
  if (!s) return true; // 如果你 CSV 没填 status，默认当作上架
  return ["1", "true", "yes", "on", "active", "enabled", "publish", "published", "online"].includes(s);
}

function keyOf(p) {
  // 用 market+asin 唯一识别
  return `${normalizeMarket(p.market)}|${normalizeAsin(p.asin)}`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "github-actions-sync/1.0",
      "cache-control": "no-cache",
      "pragma": "no-cache",
    },
  });
  if (!res.ok) throw new Error(`Fetch CSV failed: HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

// --- main ---
(async () => {
  console.log("[sync] CSV_URL =", CSV_URL);

  const csvText = await fetchText(CSV_URL);
  console.log("[sync] CSV bytes =", csvText.length);

  const rows = parseCSV(csvText);
  if (!rows.length) throw new Error("CSV is empty");

  const headers = rows[0].map(h => String(h || "").trim());
  const dataRows = rows.slice(1).filter(r => r.some(c => String(c || "").trim() !== ""));

  console.log("[sync] headers =", headers.join(" | "));
  console.log("[sync] data rows =", dataRows.length);

  // read existing for archive diff
  const prevProducts = Array.isArray(safeReadJson(PRODUCTS_PATH, [])) ? safeReadJson(PRODUCTS_PATH, []) : [];
  const prevArchive = Array.isArray(safeReadJson(ARCHIVE_PATH, [])) ? safeReadJson(ARCHIVE_PATH, []) : [];

  const prevMap = new Map();
  prevProducts.forEach(p => prevMap.set(keyOf(p), p));

  const archiveMap = new Map();
  prevArchive.forEach(p => archiveMap.set(keyOf(p), p));

  // build new active list from CSV (source of truth)
  const nextProducts = [];
  for (const r of dataRows) {
    const o = mapRow(headers, r);

    const market = normalizeMarket(o.market || o.Market || o.MARKET);
    const asin = normalizeAsin(o.asin || o.ASIN);
    if (!market || !asin) continue;

    // status optional
    const statusVal = o.status ?? o.Status ?? o.STATUS;
    if (!isActiveStatus(statusVal)) continue;

    const link = normalizeUrl(o.link || o.Link);
    const image_url = (o.image_url || o.image || o.Image || o.imageUrl || "").trim();

    // 只保留前端需要的字段（title 保留也行，但你前端不展示 title）
    nextProducts.push({
      market,
      asin,
      title: String(o.title || o.Title || "").trim(),
      link,
      image_url,
    });
  }

  // stable sort for deterministic diffs
  nextProducts.sort((a, b) => {
    const am = a.market.localeCompare(b.market);
    if (am) return am;
    return a.asin.localeCompare(b.asin);
  });

  // move removed items into archive
  const nextKeys = new Set(nextProducts.map(keyOf));
  let removedCount = 0;
  for (const [k, oldP] of prevMap.entries()) {
    if (!nextKeys.has(k)) {
      // removed from active => ensure in archive
      if (!archiveMap.has(k)) {
        archiveMap.set(k, oldP);
      }
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
})().catch(err => {
  console.error("[fatal]", err?.stack || err);
  process.exit(1);
});
