import fs from "fs";
import path from "path";

const CSV_URL = "http://154.48.226.95:5001/admin/Product/export_csv";

function parseCSV(csvText) {
  // 可靠 CSV 解析：支持双引号、逗号、换行
  const rows = [];
  let cur = [];
  let val = "";
  let inQuotes = false;

  const s = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (c === '"') {
      if (inQuotes && s[i + 1] === '"') {
        val += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      cur.push(val);
      val = "";
    } else if (c === "\n" && !inQuotes) {
      cur.push(val);
      rows.push(cur);
      cur = [];
      val = "";
    } else {
      val += c;
    }
  }
  if (val.length || cur.length) {
    cur.push(val);
    rows.push(cur);
  }

  const cleaned = rows
    .map(r => r.map(x => (x ?? "").trim()))
    .filter(r => r.some(x => x !== ""));

  if (!cleaned.length) return [];

  const header = cleaned[0].map(x => x.toLowerCase());
  const hasHeader = header.includes("market") && header.includes("asin");
  const dataRows = hasHeader ? cleaned.slice(1) : cleaned;

  // 按你字段顺序：market asin title keyword store remark link image_url Discount Price Commission status
  const products = dataRows.map(cols => ({
    market: (cols[0] || "").trim(),
    asin: (cols[1] || "").trim(),
    title: (cols[2] || "").trim(),
    keyword: (cols[3] || "").trim(),
    store: (cols[4] || "").trim(),
    remark: (cols[5] || "").trim(),
    link: (cols[6] || "").trim(),
    image_url: (cols[7] || "").trim(),
    price: (cols[8] || "").trim(),
    commission: (cols[9] || "").trim(),
    status: (cols[10] || "").trim(),
  }));

  // 基础清洗：必须有 market/asin；可选只保留 active
  return products
    .filter(p => p.market && p.asin)
    .filter(p => !p.status || p.status.toLowerCase() === "active");
}

async function main() {
  console.log("[sync] Fetching CSV:", CSV_URL);

  // Node 20+ 自带 fetch
  const res = await fetch(CSV_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/csv,*/*",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Upstream HTTP ${res.status} ${res.statusText}`);
  }

  const csvText = await res.text();

  // 保存一份原始 CSV 方便你排查
  fs.writeFileSync("products.csv", csvText, "utf-8");

  const products = parseCSV(csvText);

  // 输出 JSON
  const out = JSON.stringify(products, null, 2);
  fs.writeFileSync("products.json", out, "utf-8");

  console.log(`[sync] Done. products: ${products.length}`);
}

main().catch(err => {
  console.error("[sync] Failed:", err);
  process.exit(1);
});
