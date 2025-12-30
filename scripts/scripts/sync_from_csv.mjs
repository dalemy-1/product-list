/**
 * scripts/sync_from_csv.mjs
 * 功能：
 * - 从 env.CSV_URL 拉取 CSV（可配合 workflow 里 env）
 * - 以 CSV 为唯一真源：完全重建 products.json
 * - 下架/移除的写入 archive.json（独立页兜底）
 * - 尽量同时写入仓库根目录与 docs/（若存在）
 *
 * 约定：
 * - CSV 至少包含：market, asin, link, image_url, status（其他列可选）
 * - status: 支持 active / online / 1 / true / enabled / published 视为上架
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const CSV_URL = (process.env.CSV_URL || "").trim();
if (!CSV_URL) {
  console.error("[fatal] CSV_URL is empty. Please set env.CSV_URL in workflow.");
  process.exit(1);
}

// 输出：优先写 docs/（GitHub Pages 常用），同时写根目录做兼容
const HAS_DOCS = fs.existsSync(path.join(ROOT, "docs")) && fs.statSync(path.join(ROOT, "docs")).isDirectory();

const OUT_PRODUCTS = [
  path.join(ROOT, "products.json"),
  ...(HAS_DOCS ? [path.join(ROOT, "docs", "products.json")] : []),
];

const OUT_ARCHIVE = [
  path.join(ROOT, "archive.json"),
  ...(HAS_DOCS ? [path.join(ROOT, "docs", "archive.json")] : []),
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 简易 CSV 解析（支持引号、逗号、换行）
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // 处理双引号转义 ""
        if (text[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        cur += c;
        i++;
        continue;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        row.push(cur);
        cur = "";
        i++;
        continue;
      }
      if (c === "\r") {
        i++;
        continue;
      }
      if (c === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
        i++;
        continue;
      }
      cur += c;
      i++;
    }
  }
  // last cell
  row.push(cur);
  // avoid adding empty last line
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) {
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w_]/g, "");
}

function toBoolActive(statusVal) {
  const s = String(statusVal || "").trim().toLowerCase();
  // 你可按你的 CSV 规范自行扩展
  const ACTIVE = new Set(["1", "true", "yes", "y", "active", "online", "enabled", "publish", "published", "in_stock"]);
  return ACTIVE.has(s);
}

function safeReadJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

async function fetchText(url, tries = 3) {
  let lastErr;
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(url, {
        headers: {
          "cache-control": "no-cache",
          pragma: "no-cache",
          "user-agent": "product-sync-bot/1.0",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      console.warn(`[warn] fetch failed (try ${t}/${tries}): ${e.message}`);
      if (t < tries) await sleep(800 * t);
    }
  }
  throw lastErr;
}

function buildKey(market, asin) {
  return `${String(market || "").toUpperCase()}::${String(asin || "").trim()}`;
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
  }
  return "";
}

function ensureDirForFile(fp) {
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJSONMulti(paths, data) {
  const body = JSON.stringify(data, null, 2);
  for (const p of paths) {
    ensureDirForFile(p);
    fs.writeFileSync(p, body + "\n", "utf-8");
    console.log(`[ok] wrote ${p}`);
  }
}

async function main() {
  console.log(`[info] CSV_URL = ${CSV_URL}`);
  const csvText = await fetchText(CSV_URL, 3);

  // 基础校验
  if (!csvText || csvText.trim().length < 10) {
    throw new Error("CSV content is empty or too short.");
  }

  const rows = parseCSV(csvText);
  if (rows.length < 2) throw new Error("CSV rows < 2 (no data).");

  const header = rows[0].map(normalizeHeader);
  const idx = new Map();
  header.forEach((h, i) => idx.set(h, i));

  const required = ["market", "asin"];
  for (const r of required) {
    if (!idx.has(r)) {
      throw new Error(`CSV missing required column: ${r}`);
    }
  }

  // 兼容常见列名差异
  const col = {
    market: "market",
    asin: "asin",
    title: ["title", "product_title", "name"],
    keyword: ["keyword", "keywords"],
    store: ["store", "brand", "shop"],
    remark: ["remark", "notes", "tag"],
    link: ["link", "url", "amazon_link"],
    image_url: ["image_url", "image", "img", "imageurl"],
    discount_price: ["discount_price", "discountprice", "price"],
    commission: ["commission", "fee"],
    status: ["status", "state", "enabled"],
  };

  const now = new Date().toISOString();

  // 读取旧 archive（用于保留历史）
  const archiveOld = safeReadJSON(OUT_ARCHIVE[0], { version: 1, updatedAt: now, items: {} });
  const archiveItems = archiveOld?.items && typeof archiveOld.items === "object" ? archiveOld.items : {};

  const products = [];
  const activeKeySet = new Set();

  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = line[c] ?? "";
    }

    const market = String(obj[col.market] || "").trim().toUpperCase();
    const asin = String(obj[col.asin] || "").trim();
    if (!market || !asin) continue;

    const statusVal = pickFirst(obj, col.status);
    const isActive = toBoolActive(statusVal);

    const item = {
      market,
      asin,
      // 注意：你页面可选择不展示 title，但数据层保留更利于检索/归档
      title: pickFirst(obj, col.title) || "",
      keyword: pickFirst(obj, col.keyword) || "",
      store: pickFirst(obj, col.store) || "",
      remark: pickFirst(obj, col.remark) || "",
      link: pickFirst(obj, col.link) || "",
      image_url: pickFirst(obj, col.image_url) || "",
      discount_price: pickFirst(obj, col.discount_price) || "",
      commission: pickFirst(obj, col.commission) || "",
      status: statusVal || "",
      updatedAt: now,
    };

    const k = buildKey(market, asin);

    if (isActive) {
      products.push(item);
      activeKeySet.add(k);
    } else {
      // 下架写入 archive
      archiveItems[k] = {
        ...archiveItems[k],
        ...item,
        archivedAt: archiveItems[k]?.archivedAt || now,
        lastSeenAt: now,
      };
    }
  }

  // 对比旧 products，把“消失的”也写入 archive（解决：CSV 不再包含该行，仍可打开独立页）
  const productsOld = safeReadJSON(OUT_PRODUCTS[0], { version: 1, updatedAt: now, items: [] });
  const oldList = Array.isArray(productsOld?.items) ? productsOld.items : [];
  for (const it of oldList) {
    const k = buildKey(it.market, it.asin);
    if (!activeKeySet.has(k)) {
      archiveItems[k] = {
        ...archiveItems[k],
        ...it,
        archivedAt: archiveItems[k]?.archivedAt || now,
        lastSeenAt: now,
      };
    }
  }

  // 输出 products.json
  const outProductsObj = {
    version: 1,
    updatedAt: now,
    source: "CSV",
    count: products.length,
    items: products.sort((a, b) => {
      if (a.market !== b.market) return a.market.localeCompare(b.market);
      return a.asin.localeCompare(b.asin);
    }),
  };

  // 输出 archive.json（对象映射更好查）
  const outArchiveObj = {
    version: 1,
    updatedAt: now,
    source: "CSV",
    count: Object.keys(archiveItems).length,
    items: archiveItems,
  };

  writeJSONMulti(OUT_PRODUCTS, outProductsObj);
  writeJSONMulti(OUT_ARCHIVE, outArchiveObj);

  console.log(`[done] products=${outProductsObj.count}, archive=${outArchiveObj.count}`);
}

main().catch((e) => {
  console.error("[fatal]", e?.stack || e?.message || e);
  process.exit(1);
});
